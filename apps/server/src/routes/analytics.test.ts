// Operator-facing analytics API. Aggregates message counts for the operator's
// org along three axes: by day, by channel, and by agent. The operator UI
// renders one chart per axis.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { authRoute } from './auth.ts';
import { agentsRoute } from './agents.ts';
import { widgetRoute } from './widget.ts';
import { analyticsRoute } from './analytics.ts';

let pg: StartedPg;
let app: Hono;
let sessionRoot: string;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-analytics-rt-'));

  app = new Hono();
  const db = getDb(pg.url);
  app.route('/api/auth', authRoute({ db }));
  app.route('/api/agents', agentsRoute({ db }));
  app.route(
    '/widget',
    widgetRoute({ db, sessionRoot, invokeAgent: async () => 'hi back' }),
  );
  app.route('/api/analytics', analyticsRoute({ db }));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
  await rm(sessionRoot, { recursive: true, force: true });
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(
    sql`TRUNCATE TABLE "agent_message", "agent_session", "identifier", "contact", "channel", "agent", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );
});

async function registerAndCookie(email: string): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return /nexus_session=[^;]+/.exec(setCookie)![0];
}

async function createAgent(
  cookie: string,
  name: string,
): Promise<{ id: string; widgetChannelId: string }> {
  const create = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name,
      persona: 'p',
      model: 'm',
      voiceEnabled: false,
    }),
  });
  const { agent } = (await create.json()) as {
    agent: { id: string; widgetChannelId: string };
  };
  return agent;
}

async function sendWidgetMessage(channelId: string, widgetSessionId: string, content: string) {
  const res = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, widgetSessionId, content }),
  });
  if (res.status !== 200) {
    throw new Error(`widget post failed: ${res.status} ${await res.text()}`);
  }
}

test('unauthenticated requests are rejected with 401', async () => {
  const res = await app.request('/api/analytics');
  expect(res.status).toBe(401);
});

test('GET /api/analytics returns zero counts for a fresh org', async () => {
  const cookie = await registerAndCookie('fresh@example.com');
  const res = await app.request('/api/analytics', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    overTime: Array<{ day: string; count: number }>;
    perChannel: Array<{ channelKind: string; count: number }>;
    perAgent: Array<{ agentId: string; agentName: string; count: number }>;
  };
  expect(body.overTime).toEqual([]);
  expect(body.perChannel).toEqual([]);
  expect(body.perAgent).toEqual([]);
});

test('aggregates message counts across agents and channels', async () => {
  const cookie = await registerAndCookie('op@example.com');
  const a = await createAgent(cookie, 'Agent A');
  const b = await createAgent(cookie, 'Agent B');

  // Two widget conversations on Agent A (4 messages: 2 user + 2 assistant).
  await sendWidgetMessage(a.widgetChannelId, 'sa1', 'hello a1');
  await sendWidgetMessage(a.widgetChannelId, 'sa2', 'hello a2');

  // One widget conversation on Agent B (2 messages: 1 user + 1 assistant).
  await sendWidgetMessage(b.widgetChannelId, 'sb1', 'hello b1');

  const res = await app.request('/api/analytics', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    overTime: Array<{ day: string; count: number }>;
    perChannel: Array<{ channelKind: string; count: number }>;
    perAgent: Array<{ agentId: string; agentName: string; count: number }>;
  };

  // 6 messages total — 4 on A, 2 on B — all on widget channels, all today.
  expect(body.overTime).toHaveLength(1);
  expect(body.overTime[0]!.count).toBe(6);
  expect(body.overTime[0]!.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  expect(body.perChannel).toEqual([{ channelKind: 'widget', count: 6 }]);

  // perAgent is ordered by descending count so the busiest agent leads.
  expect(body.perAgent).toEqual([
    { agentId: a.id, agentName: 'Agent A', count: 4 },
    { agentId: b.id, agentName: 'Agent B', count: 2 },
  ]);
});

test('analytics is org-scoped: another org cannot see this org counts', async () => {
  const cookieA = await registerAndCookie('opA@example.com');
  const a = await createAgent(cookieA, 'Alpha');
  await sendWidgetMessage(a.widgetChannelId, 's1', 'hello');

  // Wipe operator + session rows so the next register creates a fresh org.
  const db = getDb(pg.url);
  await db.execute(sql`TRUNCATE TABLE "session", "user", "org" RESTART IDENTITY CASCADE`);

  const cookieB = await registerAndCookie('opB@example.com');
  const res = await app.request('/api/analytics', { headers: { cookie: cookieB } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    overTime: unknown[];
    perChannel: unknown[];
    perAgent: unknown[];
  };
  expect(body.overTime).toEqual([]);
  expect(body.perChannel).toEqual([]);
  expect(body.perAgent).toEqual([]);
});
