import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { authRoute } from './auth.ts';

let pg: StartedPg;
let app: Hono;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);

  app = new Hono();
  app.route('/api/auth', authRoute({ db: getDb(pg.url) }));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(sql`TRUNCATE TABLE "session", "user", "org" RESTART IDENTITY CASCADE`);
});

test('register creates org + user and sets a session cookie', async () => {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'op@example.com', password: 'hunter2hunter2' }),
  });

  expect(res.status).toBe(201);
  const body = (await res.json()) as { user: { id: string; email: string; orgId: string } };
  expect(body.user.email).toBe('op@example.com');
  expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.user.orgId).toMatch(/^[0-9a-f-]{36}$/);

  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('nexus_session=');
  expect(setCookie.toLowerCase()).toContain('httponly');
});

test('register → me returns the same user; logout clears the session', async () => {
  const reg = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'op@example.com', password: 'hunter2hunter2' }),
  });
  const cookie = sessionCookie(reg);

  const meOk = await app.request('/api/auth/me', { headers: { cookie } });
  expect(meOk.status).toBe(200);
  const meBody = (await meOk.json()) as { user: { email: string } };
  expect(meBody.user.email).toBe('op@example.com');

  const out = await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
  expect(out.status).toBe(200);

  const meAfter = await app.request('/api/auth/me', { headers: { cookie } });
  expect(meAfter.status).toBe(401);
});

test('login with the right password issues a fresh session; wrong password is rejected', async () => {
  await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'op@example.com', password: 'hunter2hunter2' }),
  });

  const wrong = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'op@example.com', password: 'nope-nope-nope' }),
  });
  expect(wrong.status).toBe(401);

  const right = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'op@example.com', password: 'hunter2hunter2' }),
  });
  expect(right.status).toBe(200);
  const cookie = sessionCookie(right);

  const me = await app.request('/api/auth/me', { headers: { cookie } });
  expect(me.status).toBe(200);
});

test('first registration creates a new org; second registration joins that org', async () => {
  const r1 = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'first@example.com', password: 'hunter2hunter2' }),
  });
  expect(r1.status).toBe(201);
  const u1 = (await r1.json()) as { user: { orgId: string } };

  const r2 = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'second@example.com', password: 'hunter2hunter2' }),
  });
  expect(r2.status).toBe(201);
  const u2 = (await r2.json()) as { user: { orgId: string } };

  expect(u2.user.orgId).toBe(u1.user.orgId);
});

test('register rejects duplicate email', async () => {
  await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'op@example.com', password: 'hunter2hunter2' }),
  });
  const dup = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'op@example.com', password: 'hunter2hunter2' }),
  });
  expect(dup.status).toBe(409);
});

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /nexus_session=[^;]+/.exec(setCookie);
  if (!match) throw new Error('no nexus_session cookie set');
  return match[0];
}
