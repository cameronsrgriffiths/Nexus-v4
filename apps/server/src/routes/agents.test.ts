import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { authRoute } from './auth.ts';
import { agentsRoute } from './agents.ts';

let pg: StartedPg;
let app: Hono;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);

  app = new Hono();
  const db = getDb(pg.url);
  app.route('/api/auth', authRoute({ db }));
  app.route('/api/agents', agentsRoute({ db }));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(sql`TRUNCATE TABLE "agent", "session", "user", "org" RESTART IDENTITY CASCADE`);
});

async function registerAndCookie(email: string): Promise<string> {
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
  return match[0];
}

test('unauthenticated requests are rejected with 401', async () => {
  const res = await app.request('/api/agents', { method: 'GET' });
  expect(res.status).toBe(401);
});

test('GET /api/agents returns 200 with empty list for a fresh org', async () => {
  const cookie = await registerAndCookie('fresh@example.com');
  const res = await app.request('/api/agents', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { agents: unknown[] };
  expect(body.agents).toEqual([]);
});

test('create agent → list returns it scoped to operator org', async () => {
  const cookie = await registerAndCookie('op@example.com');

  const create = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Sales Bot',
      persona: 'Friendly sales rep who answers product questions.',
      model: 'gpt-4o-mini',
      voiceEnabled: false,
    }),
  });
  expect(create.status).toBe(201);
  const created = (await create.json()) as {
    agent: {
      id: string;
      name: string;
      persona: string;
      model: string;
      runtimeMode: string;
      voiceEnabled: boolean;
      widgetChannelId: string | null;
    };
  };
  expect(created.agent.name).toBe('Sales Bot');
  expect(created.agent.runtimeMode).toBe('headless');
  expect(created.agent.voiceEnabled).toBe(false);
  expect(created.agent.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(created.agent.widgetChannelId).toMatch(/^[0-9a-f-]{36}$/);

  const list = await app.request('/api/agents', { headers: { cookie } });
  expect(list.status).toBe(200);
  const body = (await list.json()) as { agents: Array<{ id: string; name: string }> };
  expect(body.agents).toHaveLength(1);
  expect(body.agents[0]!.id).toBe(created.agent.id);
});

test('create rejects bad payload with 400', async () => {
  const cookie = await registerAndCookie('op@example.com');
  const res = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: '' }),
  });
  expect(res.status).toBe(400);
});

test('list is org-scoped: another org cannot see this org agents', async () => {
  // First op creates an agent.
  const cookieA = await registerAndCookie('opA@example.com');
  await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({
      name: 'Alpha',
      persona: 'Persona A',
      model: 'gpt-4o-mini',
      voiceEnabled: false,
    }),
  });

  // Wipe everything so the next "first" registration creates a fresh org.
  const db = getDb(pg.url);
  await db.execute(sql`TRUNCATE TABLE "session", "user", "org" RESTART IDENTITY CASCADE`);

  const cookieB = await registerAndCookie('opB@example.com');
  const list = await app.request('/api/agents', { headers: { cookie: cookieB } });
  expect(list.status).toBe(200);
  const body = (await list.json()) as { agents: unknown[] };
  expect(body.agents).toEqual([]);
});

test('update agent persists persona, model, and voice toggle', async () => {
  const cookie = await registerAndCookie('op@example.com');
  const create = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Sales Bot',
      persona: 'old persona',
      model: 'gpt-4o-mini',
      voiceEnabled: false,
    }),
  });
  const { agent } = (await create.json()) as { agent: { id: string } };

  const upd = await app.request(`/api/agents/${agent.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Sales Bot v2',
      persona: 'new persona',
      model: 'gpt-4o',
      voiceEnabled: true,
    }),
  });
  expect(upd.status).toBe(200);
  const updated = (await upd.json()) as {
    agent: { name: string; persona: string; model: string; voiceEnabled: boolean };
  };
  expect(updated.agent.name).toBe('Sales Bot v2');
  expect(updated.agent.persona).toBe('new persona');
  expect(updated.agent.model).toBe('gpt-4o');
  expect(updated.agent.voiceEnabled).toBe(true);
});

test('delete removes the agent', async () => {
  const cookie = await registerAndCookie('op@example.com');
  const create = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Throwaway',
      persona: 'persona',
      model: 'gpt-4o-mini',
      voiceEnabled: false,
    }),
  });
  const { agent } = (await create.json()) as { agent: { id: string } };

  const del = await app.request(`/api/agents/${agent.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  expect(del.status).toBe(204);

  const list = await app.request('/api/agents', { headers: { cookie } });
  const body = (await list.json()) as { agents: unknown[] };
  expect(body.agents).toEqual([]);
});

test('update / delete on another org returns 404', async () => {
  const cookieA = await registerAndCookie('opA@example.com');
  const create = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({
      name: 'Alpha',
      persona: 'pa',
      model: 'gpt-4o-mini',
      voiceEnabled: false,
    }),
  });
  const { agent } = (await create.json()) as { agent: { id: string } };

  const db = getDb(pg.url);
  await db.execute(sql`TRUNCATE TABLE "session", "user", "org" RESTART IDENTITY CASCADE`);

  const cookieB = await registerAndCookie('opB@example.com');
  const upd = await app.request(`/api/agents/${agent.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ name: 'X', persona: 'p', model: 'gpt-4o-mini', voiceEnabled: false }),
  });
  expect(upd.status).toBe(404);

  const del = await app.request(`/api/agents/${agent.id}`, {
    method: 'DELETE',
    headers: { cookie: cookieB },
  });
  expect(del.status).toBe(404);
});
