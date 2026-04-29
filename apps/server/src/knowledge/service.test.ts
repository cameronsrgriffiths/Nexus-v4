import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { runMigrations } from '../db/client.ts';
import { org } from '../db/schema.ts';
import { createKnowledgeService, type KnowledgeService } from './service.ts';
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

test('create then search recalls the page via FTS keyword match', async () => {
  const contactId = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: contactId,
    mode: 'create',
    title: 'allergies',
    content: 'The contact is allergic to peanuts and shellfish.',
  });
  expect(created.ok).toBe(true);

  const result = await service.search(orgId, {
    scope: 'contact',
    scopeId: contactId,
    query: 'peanut allergy',
    topN: 5,
  });
  expect(result.pages).toHaveLength(1);
  expect(result.pages[0]!.title).toBe('allergies');
  expect(result.pages[0]!.content).toContain('peanuts');
  expect(result.pages[0]!.version).toBe(1);
});

test('search recalls via semantic paraphrase (vector path)', async () => {
  // The query shares no exact tokens with the stored content (after stemming
  // of plural/-ing), so the FTS rank is zero or very low — recall has to come
  // from the embedding path.
  const contactId = crypto.randomUUID();
  await service.write(orgId, {
    scope: 'contact',
    scopeId: contactId,
    mode: 'create',
    title: 'pets',
    content: 'Owns two cats and prefers communication via text message.',
  });

  const result = await service.search(orgId, {
    scope: 'contact',
    scopeId: contactId,
    query: 'cat owner texting preference',
    topN: 5,
  });
  expect(result.pages).toHaveLength(1);
  expect(result.pages[0]!.title).toBe('pets');
});

test('search is scope-isolated: pages in other scopes are not returned', async () => {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await service.write(orgId, {
    scope: 'contact',
    scopeId: a,
    mode: 'create',
    title: 'note',
    content: 'Lives in Paris and speaks French.',
  });
  await service.write(orgId, {
    scope: 'contact',
    scopeId: b,
    mode: 'create',
    title: 'note',
    content: 'Lives in Paris and speaks French.',
  });

  const result = await service.search(orgId, {
    scope: 'contact',
    scopeId: a,
    query: 'Paris French',
    topN: 5,
  });
  expect(result.pages).toHaveLength(1);
});

test('write mode=create rejects when a page already exists at the same title', async () => {
  const c = crypto.randomUUID();
  await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'first',
  });
  const result = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'second',
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe('already_exists');
});

test('write mode=append concatenates and bumps version when version matches', async () => {
  const c = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'line one',
  });
  if (!created.ok) throw new Error('create failed');

  const appended = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'append',
    title: 'note',
    content: 'line two',
    version: created.version,
  });
  expect(appended.ok).toBe(true);
  if (appended.ok) expect(appended.version).toBe(created.version + 1);

  const result = await service.search(orgId, {
    scope: 'contact',
    scopeId: c,
    query: 'line',
    topN: 5,
  });
  expect(result.pages[0]!.content).toBe('line one\nline two');
  expect(result.pages[0]!.version).toBe(2);
});

test('write mode=overwrite replaces content and bumps version when version matches', async () => {
  const c = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'old content',
  });
  if (!created.ok) throw new Error('create failed');

  const overwritten = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'overwrite',
    title: 'note',
    content: 'new content',
    version: created.version,
  });
  expect(overwritten.ok).toBe(true);

  const result = await service.search(orgId, {
    scope: 'contact',
    scopeId: c,
    query: 'content',
    topN: 5,
  });
  expect(result.pages[0]!.content).toBe('new content');
});

test('write returns conflict with current content when version is stale', async () => {
  const c = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'create',
    title: 'note',
    content: 'v1',
  });
  if (!created.ok) throw new Error('create failed');

  // Bump the version once.
  const bumped = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'overwrite',
    title: 'note',
    content: 'v2',
    version: created.version,
  });
  if (!bumped.ok) throw new Error('first overwrite failed');

  // Caller still has the old version.
  const stale = await service.write(orgId, {
    scope: 'contact',
    scopeId: c,
    mode: 'overwrite',
    title: 'note',
    content: 'v3',
    version: created.version,
  });
  expect(stale.ok).toBe(false);
  if (!stale.ok && stale.reason === 'conflict') {
    expect(stale.currentVersion).toBe(2);
    expect(stale.currentContent).toBe('v2');
  } else {
    throw new Error(`expected conflict, got ${JSON.stringify(stale)}`);
  }
});

test('write mode=append on missing page returns not_found', async () => {
  const result = await service.write(orgId, {
    scope: 'contact',
    scopeId: crypto.randomUUID(),
    mode: 'append',
    title: 'nope',
    content: 'x',
    version: 1,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe('not_found');
});

test('write to a moved page returns page_moved with new coordinates', async () => {
  const oldContact = crypto.randomUUID();
  const newContact = crypto.randomUUID();
  const created = await service.write(orgId, {
    scope: 'contact',
    scopeId: oldContact,
    mode: 'create',
    title: 'note',
    content: 'merge me',
  });
  if (!created.ok) throw new Error('create failed');

  // Simulate a scope move: the page is now owned by a different contact.
  const moved = await service.move(orgId, {
    fromId: created.id,
    toScope: 'contact',
    toScopeId: newContact,
  });
  expect(moved.ok).toBe(true);

  // An in-flight writer that still holds the old coordinates writes against
  // the original location.
  const result = await service.write(orgId, {
    scope: 'contact',
    scopeId: oldContact,
    mode: 'append',
    title: 'note',
    content: 'late',
    version: created.version,
  });
  expect(result.ok).toBe(false);
  if (!result.ok && result.reason === 'page_moved') {
    expect(result.newScopeId).toBe(newContact);
    expect(result.newScope).toBe('contact');
  } else {
    throw new Error(`expected page_moved, got ${JSON.stringify(result)}`);
  }
});
