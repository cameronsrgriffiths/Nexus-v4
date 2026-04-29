// Operator-side conflict policy for the knowledge edit UI.
//
// The plain knowledge service is symmetric — every writer races on version.
// The operator UI layers two policies on top:
//
//   1. Append-vs-append auto-merge. If every intervening write between the
//      operator's loaded version and current is an append, the operator's
//      append goes on top of current with no dialog.
//
//   2. Force-overwrite. Operator commits over a stale version explicitly.
//      The latest intervening write (the agent's overwrite that triggered the
//      conflict) is linked to the new force-row in knowledge_write_log so the
//      audit trail surfaces it as "lost to force".
//
// Anything that doesn't qualify for auto-merge surfaces a `conflict` result
// with the current content + version; the UI shows the two-button dialog.

import { and, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { knowledgePage, knowledgeWriteLog } from '../db/schema.ts';
import type { KnowledgeService, KnowledgeScope, WriteParams, WriteResult } from './service.ts';
import type { Embedder } from '../embedding/client.ts';

type Deps = {
  db: PostgresJsDatabase;
  service: KnowledgeService;
  orgId: string;
};

export type AgentWriteArgs = Deps & { params: WriteParams };

// Convenience wrapper — equivalent to service.write with actor='agent'. Used
// by tests and the test-only agent-write API endpoint that backs the conflict
// E2E.
export function agentWrite(args: AgentWriteArgs): Promise<WriteResult> {
  return args.service.write(args.orgId, args.params, { actor: 'agent' });
}

export type OperatorSaveArgs = Deps & {
  scope: KnowledgeScope;
  scopeId: string;
  title: string;
  mode: 'append' | 'overwrite';
  content: string;
  // The version the operator's UI loaded. The save fails or auto-merges
  // depending on what's happened since.
  version: number;
};

export type OperatorSaveResult =
  | { ok: true; id: string; version: number; autoMerged: boolean }
  | {
      ok: false;
      reason: 'conflict';
      currentContent: string;
      currentVersion: number;
      id: string;
    }
  | { ok: false; reason: 'not_found' };

export async function operatorSave(args: OperatorSaveArgs): Promise<OperatorSaveResult> {
  const { db, service, orgId } = args;
  const looked = await service.lookup(orgId, {
    scope: args.scope,
    scopeId: args.scopeId,
    title: args.title,
  });
  if (looked.kind !== 'found') {
    return { ok: false, reason: 'not_found' };
  }

  // Happy path: operator's loaded version is current. Use the regular write.
  if (looked.version === args.version) {
    const result = await service.write(
      orgId,
      {
        scope: args.scope,
        scopeId: args.scopeId,
        mode: args.mode,
        title: args.title,
        content: args.content,
        version: args.version,
      },
      { actor: 'operator' },
    );
    return mapWriteResult(result, false);
  }

  // Stale version. If operator submitted append AND every intervening write
  // is also an append, auto-merge — append the operator's text on top of
  // current and write at the latest version.
  if (args.mode === 'append') {
    const intervening = await db
      .select({ mode: knowledgeWriteLog.mode })
      .from(knowledgeWriteLog)
      .where(
        and(
          eq(knowledgeWriteLog.pageId, looked.id),
          gt(knowledgeWriteLog.versionAfter, args.version),
        ),
      );
    const allAppend =
      intervening.length > 0 && intervening.every((row) => row.mode === 'append');
    if (allAppend) {
      const result = await service.write(
        orgId,
        {
          scope: args.scope,
          scopeId: args.scopeId,
          mode: 'append',
          title: args.title,
          content: args.content,
          version: looked.version,
        },
        { actor: 'operator' },
      );
      return mapWriteResult(result, true);
    }
  }

  return {
    ok: false,
    reason: 'conflict',
    currentContent: looked.content,
    currentVersion: looked.version,
    id: looked.id,
  };
}

export type OperatorForceArgs = Deps & {
  scope: KnowledgeScope;
  scopeId: string;
  title: string;
  content: string;
  // Optional embedder override. Production wires the same embedder the
  // service uses; tests reach the embedder via the service's closure.
  embedder?: Embedder;
};

export type OperatorForceResult =
  | { ok: true; id: string; version: number }
  | { ok: false; reason: 'not_found' };

// Force-overwrite: operator commits their content regardless of the current
// version. The latest existing log row (which is the agent write that was
// overwritten) gets linked to the new force-row so the audit log surfaces
// what was lost.
export async function operatorForce(args: OperatorForceArgs): Promise<OperatorForceResult> {
  const { db, service, orgId } = args;
  const looked = await service.lookup(orgId, {
    scope: args.scope,
    scopeId: args.scopeId,
    title: args.title,
  });
  if (looked.kind !== 'found') {
    return { ok: false, reason: 'not_found' };
  }

  // Identify the latest log row before the force. After a force we mark this
  // row as "lost to" the new force row.
  const [latest] = await db
    .select({ id: knowledgeWriteLog.id, versionAfter: knowledgeWriteLog.versionAfter })
    .from(knowledgeWriteLog)
    .where(eq(knowledgeWriteLog.pageId, looked.id))
    .orderBy(sql`version_after DESC`)
    .limit(1);

  // Drive the actual write through the service so embedding + tsv stay in
  // sync. Use mode='overwrite' at the latest version so OCC always passes
  // (we just read the current version one statement above; barring a
  // concurrent writer between read and write we're guaranteed to match).
  // Note: the service logs this as actor='operator' mode='overwrite'; we
  // patch the log row to mode='force' below so the audit distinguishes a
  // force from a routine overwrite.
  const writeResult = await service.write(
    orgId,
    {
      scope: args.scope,
      scopeId: args.scopeId,
      mode: 'overwrite',
      title: args.title,
      content: args.content,
      version: looked.version,
    },
    { actor: 'operator' },
  );

  if (!writeResult.ok) {
    // Race against an agent that wrote between our read and our write. Retry
    // once with the fresh version; in practice this almost never fires
    // because the operator is the slow path.
    if (writeResult.reason === 'conflict') {
      return retryForce(args, latest?.id);
    }
    if (writeResult.reason === 'not_found') {
      return { ok: false, reason: 'not_found' };
    }
    // page_moved / already_exists are unreachable for the overwrite path here.
    throw new Error(`unexpected force-write failure: ${writeResult.reason}`);
  }

  // Patch the just-inserted log row's mode to 'force' so the audit row is
  // distinguishable from a routine operator overwrite.
  const [forceRow] = await db
    .update(knowledgeWriteLog)
    .set({ mode: 'force' })
    .where(
      and(
        eq(knowledgeWriteLog.pageId, writeResult.id),
        eq(knowledgeWriteLog.versionAfter, writeResult.version),
      ),
    )
    .returning({ id: knowledgeWriteLog.id });

  // Link the lost agent write (the prior latest) to the force row.
  if (latest && forceRow) {
    await db
      .update(knowledgeWriteLog)
      .set({ lostToForceById: forceRow.id })
      .where(eq(knowledgeWriteLog.id, latest.id));
  }

  return { ok: true, id: writeResult.id, version: writeResult.version };
}

async function retryForce(
  args: OperatorForceArgs,
  // Pass through the original "latest" id so the linkage stays correct even
  // after the retry. If undefined, we'll pick the latest at retry time.
  originalLatestId: string | undefined,
): Promise<OperatorForceResult> {
  const { db, service, orgId } = args;
  const looked = await service.lookup(orgId, {
    scope: args.scope,
    scopeId: args.scopeId,
    title: args.title,
  });
  if (looked.kind !== 'found') return { ok: false, reason: 'not_found' };
  const result = await service.write(
    orgId,
    {
      scope: args.scope,
      scopeId: args.scopeId,
      mode: 'overwrite',
      title: args.title,
      content: args.content,
      version: looked.version,
    },
    { actor: 'operator' },
  );
  if (!result.ok) {
    throw new Error(`force retry failed: ${result.reason}`);
  }
  const [forceRow] = await db
    .update(knowledgeWriteLog)
    .set({ mode: 'force' })
    .where(
      and(
        eq(knowledgeWriteLog.pageId, result.id),
        eq(knowledgeWriteLog.versionAfter, result.version),
      ),
    )
    .returning({ id: knowledgeWriteLog.id });
  const lostId =
    originalLatestId ??
    (
      await db
        .select({ id: knowledgeWriteLog.id })
        .from(knowledgeWriteLog)
        .where(
          and(
            eq(knowledgeWriteLog.pageId, result.id),
            eq(knowledgeWriteLog.versionAfter, result.version - 1),
          ),
        )
        .limit(1)
    )[0]?.id;
  if (lostId && forceRow) {
    await db
      .update(knowledgeWriteLog)
      .set({ lostToForceById: forceRow.id })
      .where(eq(knowledgeWriteLog.id, lostId));
  }
  return { ok: true, id: result.id, version: result.version };
}

function mapWriteResult(result: WriteResult, autoMerged: boolean): OperatorSaveResult {
  if (result.ok) {
    return { ok: true, id: result.id, version: result.version, autoMerged };
  }
  if (result.reason === 'conflict') {
    return {
      ok: false,
      reason: 'conflict',
      currentContent: result.currentContent,
      currentVersion: result.currentVersion,
      id: result.id,
    };
  }
  if (result.reason === 'not_found') {
    return { ok: false, reason: 'not_found' };
  }
  // page_moved / already_exists aren't reachable for the operator path: the
  // operator always writes against an existing page they just loaded.
  throw new Error(`unexpected operator-save service result: ${result.reason}`);
}

// Avoid an unused-import warning when this file is consumed without the type.
export type { KnowledgeService };

// (knowledgePage import is kept around for future operator helpers that read
// page metadata directly; right now we go through the service.)
void knowledgePage;
