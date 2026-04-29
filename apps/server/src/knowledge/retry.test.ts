import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { runMigrations } from '../db/client.ts';
import { org } from '../db/schema.ts';
import { createKnowledgeService, type KnowledgeService } from './service.ts';
import { writeKnowledgeWithRetry, MAX_WRITE_RETRIES } from './retry.ts';
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
  await db.execute(sql`TRUNCATE TABLE "knowledge_page", "org" RESTART IDENTITY CASCADE`);
  const [row] = await db
    .insert(org)
    .values({ name: `test-org-${crypto.randomUUID()}` })
    .returning({ id: org.id });
  orgId = row!.id;
});

test('writeKnowledgeWithRetry: retries up to MAX_WRITE_RETRIES on conflict, then surfaces failure', async () => {
  const c = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'starts at v1',
  });
  if (!created.ok) throw new Error('create failed');

  // Simulate a faster competing writer that bumps the version on every read.
  // Each call to our retry helper races against a concurrent overwrite that
  // we trigger by hand inside the readCurrent callback.
  let conflictRounds = 0;
  const result = await writeKnowledgeWithRetry({
    service,
    orgId,
    scope: 'contact',
    scopeId: c,
    title: 'note',
    mode: 'append',
    contentToWrite: () => 'late writer',
    onBeforeAttempt: async () => {
      // On every attempt, sneak in another overwrite so the writer's read is
      // always stale by the time it tries to commit.
      conflictRounds++;
      const fresh = await service.search(orgId, {
        scope: 'contact',
        scopeId: c,
        query: 'starts',
        topN: 1,
      });
      const page = fresh.pages[0]!;
      await service.write(orgId, {
        scope: 'contact',
        scopeId: c,
        mode: 'overwrite',
        title: 'note',
        content: `bumped #${conflictRounds}`,
        version: page.version,
      });
    },
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe('conflict_max_retries');
    expect(result.attempts).toBe(MAX_WRITE_RETRIES);
  }
});

test('writeKnowledgeWithRetry: succeeds on a later attempt when conflict resolves', async () => {
  const c = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'starts at v1',
  });
  if (!created.ok) throw new Error('create failed');

  // First attempt sees a conflict, second attempt does not.
  let attempts = 0;
  const result = await writeKnowledgeWithRetry({
    service,
    orgId,
    scope: 'contact',
    scopeId: c,
    title: 'note',
    mode: 'append',
    contentToWrite: () => 'finally',
    onBeforeAttempt: async () => {
      attempts++;
      if (attempts === 1) {
        const fresh = await service.search(orgId, {
          scope: 'contact',
          scopeId: c,
          query: 'starts',
          topN: 1,
        });
        const page = fresh.pages[0]!;
        await service.write(orgId, {
          scope: 'contact',
          scopeId: c,
          mode: 'overwrite',
          title: 'note',
          content: 'bumped',
          version: page.version,
        });
      }
    },
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.attempts).toBe(2);
});

test('writeKnowledgeWithRetry: two concurrent writers — one wins, the other retries and also wins', async () => {
  const c = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'base',
  });
  if (!created.ok) throw new Error('create failed');

  // Both writers issue an append concurrently. With OCC + retry, both should
  // eventually land — the second has to retry against the post-first state.
  const [a, b] = await Promise.all([
    writeKnowledgeWithRetry({
      service,
      orgId,
      scope: 'contact',
      scopeId: c,
      title: 'note',
      mode: 'append',
      contentToWrite: () => 'addition-A',
    }),
    writeKnowledgeWithRetry({
      service,
      orgId,
      scope: 'contact',
      scopeId: c,
      title: 'note',
      mode: 'append',
      contentToWrite: () => 'addition-B',
    }),
  ]);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);

  const final = await service.search(orgId, {
    scope: 'contact',
    scopeId: c,
    query: 'addition',
    topN: 1,
  });
  // Final content should contain both additions (order depends on who won
  // first), and version should be base+2 = 3.
  expect(final.pages[0]!.content).toContain('addition-A');
  expect(final.pages[0]!.content).toContain('addition-B');
  expect(final.pages[0]!.version).toBe(3);
});

test('writeKnowledgeWithRetry: follows page_moved redirect', async () => {
  const oldContact = crypto.randomUUID();
  const newContact = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: oldContact,
    mode: 'create',
    title: 'note',
    content: 'will be moved',
  });
  if (!created.ok) throw new Error('create failed');

  await service.move(orgId, {
    fromId: created.id,
    toScope: 'contact',
    toScopeId: newContact,
  });

  const result = await writeKnowledgeWithRetry({
    service,
    orgId,
    scope: 'contact',
    scopeId: oldContact,
    title: 'note',
    mode: 'append',
    contentToWrite: () => 'late add',
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.scope).toBe('contact');
    expect(result.scopeId).toBe(newContact);
  }
});
