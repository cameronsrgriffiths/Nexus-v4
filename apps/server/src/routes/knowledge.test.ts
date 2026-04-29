// Operator-facing knowledge edit API. Loads a page (with version), saves
// with optimistic concurrency, and force-overwrites on demand. Powers the
// conflict-dialog UI added in this slice.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { authRoute } from './auth.ts';
import { knowledgeRoute } from './knowledge.ts';
import { createKnowledgeService } from '../knowledge/service.ts';
import { fakeEmbedder } from '../knowledge/test-helpers.ts';
import { agentWrite } from '../knowledge/operator.ts';

let pg: StartedPg;
let app: Hono;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);

  app = new Hono();
  const db = getDb(pg.url);
  const service = createKnowledgeService({ db, embedder: fakeEmbedder() });
  app.route('/api/auth', authRoute({ db }));
  app.route('/api/knowledge', knowledgeRoute({ db, service }));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(
    sql`TRUNCATE TABLE "knowledge_write_log", "knowledge_page", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );
});

async function registerAndCookie(email: string): Promise<{ cookie: string; orgId: string }> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /nexus_session=[^;]+/.exec(setCookie);
  if (!match) throw new Error('no session cookie set');
  const db = getDb(pg.url);
  const [row] = await db.execute<{ org_id: string }>(
    sql`SELECT org_id FROM "user" WHERE email = ${email} LIMIT 1`,
  );
  return { cookie: match[0], orgId: (row as { org_id: string }).org_id };
}

async function seedPage(orgId: string, scopeId: string, title: string, content: string) {
  const db = getDb(pg.url);
  const service = createKnowledgeService({ db, embedder: fakeEmbedder() });
  const result = await agentWrite({
    db,
    service,
    orgId,
    params: { scope: 'contact', scopeId, mode: 'create', title, content },
  });
  if (!result.ok) throw new Error('seed failed');
  return result;
}

test('GET /api/knowledge/page returns content + version for an existing page', async () => {
  const { cookie, orgId } = await registerAndCookie('op@example.com');
  const contactId = crypto.randomUUID();
  const seeded = await seedPage(orgId, contactId, 'allergies', 'peanuts');

  const res = await app.request(
    `/api/knowledge/page?scope=contact&scopeId=${contactId}&title=allergies`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { page: { id: string; content: string; version: number } };
  expect(body.page.id).toBe(seeded.id);
  expect(body.page.content).toBe('peanuts');
  expect(body.page.version).toBe(1);
});

test('GET /api/knowledge/page returns 404 when missing', async () => {
  const { cookie } = await registerAndCookie('op@example.com');
  const res = await app.request(
    `/api/knowledge/page?scope=contact&scopeId=${crypto.randomUUID()}&title=missing`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(404);
});

test('POST /api/knowledge/page commits a no-conflict edit', async () => {
  const { cookie, orgId } = await registerAndCookie('op@example.com');
  const contactId = crypto.randomUUID();
  const seeded = await seedPage(orgId, contactId, 'note', 'one');

  const res = await app.request('/api/knowledge/page', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      scope: 'contact',
      scopeId: contactId,
      title: 'note',
      mode: 'overwrite',
      content: 'two',
      version: seeded.version,
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; version: number; autoMerged: boolean };
  expect(body.ok).toBe(true);
  expect(body.version).toBe(2);
  expect(body.autoMerged).toBe(false);
});

test('POST /api/knowledge/page returns 409 with current state on conflict', async () => {
  const { cookie, orgId } = await registerAndCookie('op@example.com');
  const contactId = crypto.randomUUID();
  const seeded = await seedPage(orgId, contactId, 'note', 'one');

  // Agent overwrites between operator's load and submit.
  const db = getDb(pg.url);
  const service = createKnowledgeService({ db, embedder: fakeEmbedder() });
  await agentWrite({
    db,
    service,
    orgId,
    params: {
      scope: 'contact',
      scopeId: contactId,
      mode: 'overwrite',
      title: 'note',
      content: 'agent rewrote',
      version: seeded.version,
    },
  });

  const res = await app.request('/api/knowledge/page', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      scope: 'contact',
      scopeId: contactId,
      title: 'note',
      mode: 'overwrite',
      content: 'operator rewrote',
      version: seeded.version,
    }),
  });
  expect(res.status).toBe(409);
  const body = (await res.json()) as {
    reason: string;
    currentContent: string;
    currentVersion: number;
  };
  expect(body.reason).toBe('conflict');
  expect(body.currentContent).toBe('agent rewrote');
  expect(body.currentVersion).toBe(2);
});

test('POST /api/knowledge/page/force overwrites and reports the lost agent write', async () => {
  const { cookie, orgId } = await registerAndCookie('op@example.com');
  const contactId = crypto.randomUUID();
  const seeded = await seedPage(orgId, contactId, 'note', 'one');

  const db = getDb(pg.url);
  const service = createKnowledgeService({ db, embedder: fakeEmbedder() });
  await agentWrite({
    db,
    service,
    orgId,
    params: {
      scope: 'contact',
      scopeId: contactId,
      mode: 'overwrite',
      title: 'note',
      content: 'agent rewrote',
      version: seeded.version,
    },
  });

  const res = await app.request('/api/knowledge/page/force', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      scope: 'contact',
      scopeId: contactId,
      title: 'note',
      content: 'operator forced',
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; version: number };
  expect(body.ok).toBe(true);
  expect(body.version).toBe(3);

  // Pull the audit row directly from the DB to prove the lost agent write was
  // linked. The route layer doesn't need to expose this, but the row exists.
  const rows = await db.execute<{
    actor: string;
    mode: string;
    version_after: number;
    lost_to_force_by_id: string | null;
  }>(
    sql`SELECT actor, mode, version_after, lost_to_force_by_id
        FROM knowledge_write_log
        WHERE page_id = ${seeded.id}
        ORDER BY version_after`,
  );
  expect(rows[0]).toMatchObject({ actor: 'agent', mode: 'create' });
  expect(rows[1]).toMatchObject({ actor: 'agent', mode: 'overwrite' });
  expect(rows[1]!.lost_to_force_by_id).not.toBeNull();
  expect(rows[2]).toMatchObject({ actor: 'operator', mode: 'force' });
});

test('POST /api/knowledge/page auto-merges append-vs-append (200 with autoMerged=true)', async () => {
  const { cookie, orgId } = await registerAndCookie('op@example.com');
  const contactId = crypto.randomUUID();
  const seeded = await seedPage(orgId, contactId, 'note', 'base');

  const db = getDb(pg.url);
  const service = createKnowledgeService({ db, embedder: fakeEmbedder() });
  await agentWrite({
    db,
    service,
    orgId,
    params: {
      scope: 'contact',
      scopeId: contactId,
      mode: 'append',
      title: 'note',
      content: 'agent line',
      version: seeded.version,
    },
  });

  const res = await app.request('/api/knowledge/page', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      scope: 'contact',
      scopeId: contactId,
      title: 'note',
      mode: 'append',
      content: 'operator line',
      version: seeded.version,
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; version: number; autoMerged: boolean };
  expect(body.ok).toBe(true);
  expect(body.autoMerged).toBe(true);
  expect(body.version).toBe(3);

  const reload = await app.request(
    `/api/knowledge/page?scope=contact&scopeId=${contactId}&title=note`,
    { headers: { cookie } },
  );
  const rb = (await reload.json()) as { page: { content: string } };
  expect(rb.page.content).toBe('base\nagent line\noperator line');
});

test('unauthenticated requests are rejected with 401', async () => {
  const res = await app.request(
    `/api/knowledge/page?scope=contact&scopeId=${crypto.randomUUID()}&title=x`,
  );
  expect(res.status).toBe(401);
});
