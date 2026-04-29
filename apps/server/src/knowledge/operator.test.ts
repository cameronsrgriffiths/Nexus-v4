// Operator-vs-agent conflict policy for the knowledge edit UI.
//
// The plain knowledge service treats every writer the same. The operator UI
// adds two policies on top:
//   1. Append-vs-append auto-merge — if the operator and an agent both append
//      between the operator's read and submit, the operator's append goes on
//      top of current content with no dialog.
//   2. Force-overwrite — operator commits over a stale version explicitly,
//      and the lost agent write is recorded in the audit log.
//
// These tests pin both policies through the public operator-save API.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { runMigrations } from '../db/client.ts';
import { knowledgeWriteLog, org } from '../db/schema.ts';
import { createKnowledgeService, type KnowledgeService } from './service.ts';
import { agentWrite, operatorSave } from './operator.ts';
import { fakeEmbedder } from './test-helpers.ts';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://nexus:nexus@localhost:5432/nexus';

let pool: ReturnType<typeof postgres>;
let db: PostgresJsDatabase;
let service: KnowledgeService;
let orgId: string;

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = postgres(DATABASE_URL, { max: 5 });
  db = drizzle(pool);
  service = createKnowledgeService({ db, embedder: fakeEmbedder() });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE "knowledge_write_log", "knowledge_page", "org" RESTART IDENTITY CASCADE`,
  );
  const [row] = await db
    .insert(org)
    .values({ name: `test-org-${crypto.randomUUID()}` })
    .returning({ id: org.id });
  orgId = row!.id;
});

test('operatorSave with matching version writes through and logs an operator row', async () => {
  const contactId = crypto.randomUUID();
  const created = await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'create',
    title: 'note',
    content: 'starts',
  }});
  if (!created.ok) throw new Error('seed write failed');

  const result = await operatorSave({
    db,
    service,
    orgId,
    scope: 'contact',
    scopeId: contactId,
    title: 'note',
    mode: 'overwrite',
    content: 'operator update',
    version: created.version,
  });

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.version).toBe(created.version + 1);

  const logs = await db
    .select()
    .from(knowledgeWriteLog)
    .where(eq(knowledgeWriteLog.pageId, created.id))
    .orderBy(knowledgeWriteLog.versionAfter);
  expect(logs.map((l) => l.actor)).toEqual(['agent', 'operator']);
  expect(logs.map((l) => l.mode)).toEqual(['create', 'overwrite']);
  expect(logs[1]!.contentAfter).toBe('operator update');
});

test('operatorSave append-vs-append auto-merges when only intervening writes are appends', async () => {
  const contactId = crypto.randomUUID();
  const created = await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'create',
    title: 'note',
    content: 'base',
  }});
  if (!created.ok) throw new Error('seed write failed');
  const operatorVersion = created.version;

  // Agent appends after operator's read but before operator's save.
  const agentAppend = await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'append',
    title: 'note',
    content: 'agent line',
    version: created.version,
  }});
  if (!agentAppend.ok) throw new Error('agent append failed');

  // Operator submits an append against the now-stale loaded version.
  const result = await operatorSave({
    db,
    service,
    orgId,
    scope: 'contact',
    scopeId: contactId,
    title: 'note',
    mode: 'append',
    content: 'operator line',
    version: operatorVersion,
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    // Should not surface a conflict — auto-merge takes effect.
    expect(result.version).toBe(operatorVersion + 2);
  }

  const search = await service.search(orgId, {
    scope: 'contact',
    scopeId: contactId,
    query: 'base',
    topN: 1,
  });
  // Append commit order: agent first, operator second.
  expect(search.pages[0]!.content).toBe('base\nagent line\noperator line');
});

test('operatorSave with overwrite vs. agent overwrite returns conflict (no auto-merge)', async () => {
  const contactId = crypto.randomUUID();
  const created = await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'create',
    title: 'note',
    content: 'base',
  }});
  if (!created.ok) throw new Error('seed write failed');
  const operatorLoadedVersion = created.version;

  await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'overwrite',
    title: 'note',
    content: 'agent forced something else',
    version: created.version,
  }});

  const result = await operatorSave({
    db,
    service,
    orgId,
    scope: 'contact',
    scopeId: contactId,
    title: 'note',
    mode: 'overwrite',
    content: 'operator overwrite',
    version: operatorLoadedVersion,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe('conflict');
    if (result.reason === 'conflict') {
      expect(result.currentContent).toBe('agent forced something else');
      expect(result.currentVersion).toBe(operatorLoadedVersion + 1);
    }
  }
});

test('operatorSave with append vs. agent overwrite returns conflict (no auto-merge)', async () => {
  const contactId = crypto.randomUUID();
  const created = await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'create',
    title: 'note',
    content: 'base',
  }});
  if (!created.ok) throw new Error('seed write failed');
  const operatorLoadedVersion = created.version;

  await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'overwrite',
    title: 'note',
    content: 'agent rewrote everything',
    version: created.version,
  }});

  const result = await operatorSave({
    db,
    service,
    orgId,
    scope: 'contact',
    scopeId: contactId,
    title: 'note',
    mode: 'append',
    content: 'operator append',
    version: operatorLoadedVersion,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe('conflict');
  }
});

test('operatorForce overwrites the latest content and links the lost agent write to the force row', async () => {
  const contactId = crypto.randomUUID();
  const created = await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'create',
    title: 'note',
    content: 'base',
  }});
  if (!created.ok) throw new Error('seed write failed');

  await agentWrite({ db, service, orgId, params: {
    scope: 'contact',
    scopeId: contactId,
    mode: 'overwrite',
    title: 'note',
    content: 'agent overwrote',
    version: created.version,
  }});

  const { operatorForce } = await import('./operator.ts');
  const force = await operatorForce({
    db,
    service,
    orgId,
    scope: 'contact',
    scopeId: contactId,
    title: 'note',
    content: 'operator forced',
  });
  expect(force.ok).toBe(true);
  if (!force.ok) throw new Error('force should succeed');

  const logs = await db
    .select()
    .from(knowledgeWriteLog)
    .where(and(eq(knowledgeWriteLog.pageId, force.id), eq(knowledgeWriteLog.orgId, orgId)))
    .orderBy(knowledgeWriteLog.versionAfter);

  // 3 rows: create (agent), overwrite (agent, lost), force (operator).
  expect(logs).toHaveLength(3);
  expect(logs.map((l) => l.actor)).toEqual(['agent', 'agent', 'operator']);
  expect(logs[2]!.mode).toBe('force');
  // The lost agent overwrite row points at the force row that replaced it.
  expect(logs[1]!.lostToForceById).toBe(logs[2]!.id);
  // The earlier create is not "lost" — the force only displaces the latest
  // intervening agent write.
  expect(logs[0]!.lostToForceById).toBe(null);
});
