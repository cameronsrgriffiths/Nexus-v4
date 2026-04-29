// Knowledge service — backs the search_knowledge and write_knowledge tools.
//
// One row per knowledge page. Each write generates a fresh embedding via the
// injected Embedder, so reads can recall by FTS keyword and by vector
// semantics from the same row. Writes use optimistic concurrency: callers
// must pass the version they read; a stale version surfaces a `conflict`
// result with the current content so the caller can re-read and retry.

import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { knowledgePage, knowledgeWriteLog } from '../db/schema.ts';
import type { Embedder } from '../embedding/client.ts';

export type KnowledgeWriteActor = 'agent' | 'operator';

// Context attached to every write so the log row records who issued it. The
// operator UI's auto-merge / force-overwrite policies read the log back to
// reason about intervening writes; without an actor distinction "lost agent
// writes" can't be identified.
export type WriteContext = {
  actor: KnowledgeWriteActor;
};

const DEFAULT_CONTEXT: WriteContext = { actor: 'agent' };

export type KnowledgeScope = 'org' | 'agent' | 'contact';

export type ScopeRef = {
  scope: KnowledgeScope;
  scopeId: string;
};

export type SearchParams = ScopeRef & {
  query: string;
  topN: number;
};

export type SearchResult = {
  pages: Array<{
    id: string;
    title: string;
    content: string;
    version: number;
    score: number;
  }>;
};

export type WriteParams = ScopeRef &
  (
    | { mode: 'create'; title: string; content: string }
    | { mode: 'overwrite'; title: string; content: string; version: number }
    | { mode: 'append'; title: string; content: string; version: number }
  );

export type WriteResult =
  | { ok: true; id: string; version: number }
  | { ok: false; reason: 'conflict'; currentContent: string; currentVersion: number; id: string }
  | {
      ok: false;
      reason: 'page_moved';
      newScope: KnowledgeScope;
      newScopeId: string;
      newId: string;
    }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_exists'; id: string };

export type MoveParams = {
  fromId: string;
  toScope: KnowledgeScope;
  toScopeId: string;
};

export type MoveResult =
  | { ok: true; newId: string }
  | { ok: false; reason: 'not_found' };

export type LookupResult =
  | { kind: 'found'; id: string; content: string; version: number }
  | { kind: 'moved'; newScope: KnowledgeScope; newScopeId: string; newId: string }
  | { kind: 'missing' };

export type KnowledgeService = {
  search(orgId: string, params: SearchParams): Promise<SearchResult>;
  write(orgId: string, params: WriteParams, context?: WriteContext): Promise<WriteResult>;
  // Resolve a page by (scope, scopeId, title). Surfaces moved-to redirects
  // so callers (including the retry helper) can follow them without trying
  // a write first.
  lookup(orgId: string, params: ScopeRef & { title: string }): Promise<LookupResult>;
  // Moves a page to a new scope. The original row stays as a tombstone with
  // moved_to pointing at the new id; in-flight writers targeting the old
  // coordinates get a page_moved result and retry against the new location.
  move(orgId: string, params: MoveParams): Promise<MoveResult>;
};

type Deps = {
  db: PostgresJsDatabase;
  embedder: Embedder;
};

export function createKnowledgeService({ db, embedder }: Deps): KnowledgeService {
  return {
    async search(orgId, params) {
      const queryEmbedding = await embedder.embed(params.query);
      const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

      // Hybrid: rank by FTS rank + vector cosine similarity, then take top N.
      // Excludes pages that have been moved (moved_to is null).
      const rows = await db.execute<{
        id: string;
        title: string;
        content: string;
        version: number;
        score: number;
      }>(sql`
        SELECT
          id,
          title,
          content,
          version,
          (
            COALESCE(ts_rank("tsv", plainto_tsquery('english', ${params.query})), 0)
            + (1 - ("embedding" <=> ${embeddingLiteral}::vector))
          ) AS score
        FROM "knowledge_page"
        WHERE "org_id" = ${orgId}
          AND "scope" = ${params.scope}
          AND "scope_id" = ${params.scopeId}
          AND "moved_to" IS NULL
        ORDER BY score DESC
        LIMIT ${params.topN}
      `);
      return { pages: rows as Array<SearchResult['pages'][number]> };
    },

    async write(orgId, params, context = DEFAULT_CONTEXT) {
      // 1. Look up by (orgId, scope, scopeId, title).
      const existing = await db
        .select({
          id: knowledgePage.id,
          content: knowledgePage.content,
          version: knowledgePage.version,
          movedTo: knowledgePage.movedTo,
          scope: knowledgePage.scope,
          scopeId: knowledgePage.scopeId,
        })
        .from(knowledgePage)
        .where(
          and(
            eq(knowledgePage.orgId, orgId),
            eq(knowledgePage.scope, params.scope),
            eq(knowledgePage.scopeId, params.scopeId),
            eq(knowledgePage.title, params.title),
          ),
        )
        .limit(1);
      const current = existing[0];

      if (current && current.movedTo) {
        // Page was moved. Resolve forward to the new coordinates.
        const target = await db
          .select({
            id: knowledgePage.id,
            scope: knowledgePage.scope,
            scopeId: knowledgePage.scopeId,
          })
          .from(knowledgePage)
          .where(eq(knowledgePage.id, current.movedTo))
          .limit(1);
        const t = target[0];
        if (t) {
          return {
            ok: false,
            reason: 'page_moved',
            newScope: t.scope as KnowledgeScope,
            newScopeId: t.scopeId,
            newId: t.id,
          };
        }
      }

      if (params.mode === 'create') {
        if (current) return { ok: false, reason: 'already_exists', id: current.id };
        return await insertPage(db, embedder, {
          orgId,
          scope: params.scope,
          scopeId: params.scopeId,
          title: params.title,
          content: params.content,
          actor: context.actor,
        });
      }

      // append / overwrite
      if (!current) return { ok: false, reason: 'not_found' };

      if (params.version !== current.version) {
        return {
          ok: false,
          reason: 'conflict',
          currentContent: current.content,
          currentVersion: current.version,
          id: current.id,
        };
      }

      const newContent =
        params.mode === 'append' ? `${current.content}\n${params.content}` : params.content;
      const newEmbedding = await embedder.embed(newContent);
      const updated = await db
        .update(knowledgePage)
        .set({
          content: newContent,
          version: current.version + 1,
          tsv: sql`to_tsvector('english', ${params.title} || ' ' || ${newContent})`,
          embedding: newEmbedding,
          updatedAt: new Date(),
        })
        .where(
          and(eq(knowledgePage.id, current.id), eq(knowledgePage.version, params.version)),
        )
        .returning({ id: knowledgePage.id, version: knowledgePage.version });
      const u = updated[0];
      if (u) {
        await db.insert(knowledgeWriteLog).values({
          pageId: u.id,
          orgId,
          versionAfter: u.version,
          mode: params.mode,
          actor: context.actor,
          contentAfter: newContent,
        });
      }
      if (!u) {
        // Lost the race against another writer between our read and our update.
        // Re-read and surface as conflict.
        const fresh = await db
          .select({ content: knowledgePage.content, version: knowledgePage.version })
          .from(knowledgePage)
          .where(eq(knowledgePage.id, current.id))
          .limit(1);
        const f = fresh[0];
        return {
          ok: false,
          reason: 'conflict',
          currentContent: f?.content ?? current.content,
          currentVersion: f?.version ?? current.version,
          id: current.id,
        };
      }
      return { ok: true, id: u.id, version: u.version };
    },

    async lookup(orgId, params) {
      const rows = await db
        .select({
          id: knowledgePage.id,
          content: knowledgePage.content,
          version: knowledgePage.version,
          movedTo: knowledgePage.movedTo,
        })
        .from(knowledgePage)
        .where(
          and(
            eq(knowledgePage.orgId, orgId),
            eq(knowledgePage.scope, params.scope),
            eq(knowledgePage.scopeId, params.scopeId),
            eq(knowledgePage.title, params.title),
          ),
        )
        .limit(1);
      const r = rows[0];
      if (!r) return { kind: 'missing' };
      if (r.movedTo) {
        const target = await db
          .select({
            id: knowledgePage.id,
            scope: knowledgePage.scope,
            scopeId: knowledgePage.scopeId,
          })
          .from(knowledgePage)
          .where(eq(knowledgePage.id, r.movedTo))
          .limit(1);
        const t = target[0];
        if (t) {
          return {
            kind: 'moved',
            newScope: t.scope as KnowledgeScope,
            newScopeId: t.scopeId,
            newId: t.id,
          };
        }
        return { kind: 'missing' };
      }
      return { kind: 'found', id: r.id, content: r.content, version: r.version };
    },

    async move(orgId, params) {
      const source = await db
        .select({
          title: knowledgePage.title,
          content: knowledgePage.content,
          version: knowledgePage.version,
        })
        .from(knowledgePage)
        .where(and(eq(knowledgePage.orgId, orgId), eq(knowledgePage.id, params.fromId)))
        .limit(1);
      const s = source[0];
      if (!s) return { ok: false, reason: 'not_found' };

      const newEmbedding = await embedder.embed(s.content);
      const inserted = await db
        .insert(knowledgePage)
        .values({
          orgId,
          scope: params.toScope,
          scopeId: params.toScopeId,
          title: s.title,
          content: s.content,
          version: s.version,
          tsv: sql`to_tsvector('english', ${s.title} || ' ' || ${s.content})`,
          embedding: newEmbedding,
        })
        .returning({ id: knowledgePage.id });
      const newId = inserted[0]!.id;

      await db
        .update(knowledgePage)
        .set({ movedTo: newId, updatedAt: new Date() })
        .where(eq(knowledgePage.id, params.fromId));

      return { ok: true, newId };
    },
  };
}

async function insertPage(
  db: PostgresJsDatabase,
  embedder: Embedder,
  page: {
    orgId: string;
    scope: KnowledgeScope;
    scopeId: string;
    title: string;
    content: string;
    actor: KnowledgeWriteActor;
  },
): Promise<WriteResult> {
  const embedding = await embedder.embed(page.content);
  const inserted = await db
    .insert(knowledgePage)
    .values({
      orgId: page.orgId,
      scope: page.scope,
      scopeId: page.scopeId,
      title: page.title,
      content: page.content,
      tsv: sql`to_tsvector('english', ${page.title} || ' ' || ${page.content})`,
      embedding,
    })
    .returning({ id: knowledgePage.id, version: knowledgePage.version });
  const i = inserted[0]!;
  await db.insert(knowledgeWriteLog).values({
    pageId: i.id,
    orgId: page.orgId,
    versionAfter: i.version,
    mode: 'create',
    actor: page.actor,
    contentAfter: page.content,
  });
  return { ok: true, id: i.id, version: i.version };
}
