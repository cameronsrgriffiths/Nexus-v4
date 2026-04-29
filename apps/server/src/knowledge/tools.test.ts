import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { runMigrations } from '../db/client.ts';
import { org } from '../db/schema.ts';
import { createKnowledgeService } from './service.ts';
import { createKnowledgeTools } from './tools.ts';
import { fakeEmbedder } from './test-helpers.ts';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://nexus:nexus@localhost:5432/nexus';

let pool: ReturnType<typeof postgres>;
let db: PostgresJsDatabase;
let tools: ReturnType<typeof createKnowledgeTools>;
let orgId: string;

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = postgres(DATABASE_URL, { max: 5 });
  db = drizzle(pool);
  const service = createKnowledgeService({ db, embedder: fakeEmbedder() });
  tools = createKnowledgeTools(service);
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

test('write_knowledge defaults mode to append', async () => {
  const c = crypto.randomUUID();
  // First call has nothing to append to → service surfaces not_found and the
  // tool reports it. Use mode=create explicitly to seed.
  await tools.write_knowledge(orgId, {
    scope: 'contact',
    scopeId: c,
    title: 'note',
    content: 'first',
    mode: 'create',
  });

  // No mode passed → defaults to append.
  const result = await tools.write_knowledge(orgId, {
    scope: 'contact',
    scopeId: c,
    title: 'note',
    content: 'second',
  });
  expect(result.ok).toBe(true);

  const search = await tools.search_knowledge(orgId, {
    scope: 'contact',
    scopeId: c,
    query: 'note',
  });
  expect(search.pages[0]!.content).toBe('first\nsecond');
});

test('search_knowledge defaults topN', async () => {
  const c = crypto.randomUUID();
  for (let i = 0; i < 8; i++) {
    await tools.write_knowledge(orgId, {
      scope: 'contact',
      scopeId: c,
      title: `note-${i}`,
      content: `entry number ${i} about cats`,
      mode: 'create',
    });
  }
  const result = await tools.search_knowledge(orgId, {
    scope: 'contact',
    scopeId: c,
    query: 'cats',
  });
  // Default top N is 5.
  expect(result.pages.length).toBe(5);
});
