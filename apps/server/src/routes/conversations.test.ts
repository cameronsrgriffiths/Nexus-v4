// Operator-facing conversation read API. Powers the basic conversation view
// in the operator UI (#28 will replace it with the full timeline).

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
import { conversationsRoute } from './conversations.ts';

let pg: StartedPg;
let app: Hono;
let sessionRoot: string;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-conv-rt-'));

  app = new Hono();
  const db = getDb(pg.url);
  app.route('/api/auth', authRoute({ db }));
  app.route('/api/agents', agentsRoute({ db }));
  app.route(
    '/widget',
    widgetRoute({ db, sessionRoot, invokeAgent: async () => 'hi back' }),
  );
  app.route('/api/conversations', conversationsRoute({ db }));
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

async function createAgentAndChannel(cookie: string): Promise<string> {
  const create = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'a',
      persona: 'p',
      model: 'm',
      voiceEnabled: false,
    }),
  });
  // Agents auto-provision a widget channel; the id is returned with the agent.
  const { agent } = (await create.json()) as { agent: { id: string; widgetChannelId: string } };
  return agent.widgetChannelId;
}

test('GET /api/conversations lists agent sessions for the operator org', async () => {
  const cookie = await registerAndCookie('op@example.com');
  const channelId = await createAgentAndChannel(cookie);

  // No sessions yet.
  const empty = await app.request('/api/conversations', { headers: { cookie } });
  expect(empty.status).toBe(200);
  expect(((await empty.json()) as { conversations: unknown[] }).conversations).toEqual([]);

  // Send a widget message; a session is created.
  await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, widgetSessionId: 'wA', content: 'hello' }),
  });

  const list = await app.request('/api/conversations', { headers: { cookie } });
  expect(list.status).toBe(200);
  const body = (await list.json()) as {
    conversations: Array<{ id: string; agentName: string; channelKind: string }>;
  };
  expect(body.conversations).toHaveLength(1);
  expect(body.conversations[0]!.agentName).toBe('a');
  expect(body.conversations[0]!.channelKind).toBe('widget');
});

test('GET /api/conversations/:id returns the message log', async () => {
  const cookie = await registerAndCookie('op@example.com');
  const channelId = await createAgentAndChannel(cookie);

  const post = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, widgetSessionId: 'wA', content: 'hello' }),
  });
  const { sessionId } = (await post.json()) as { sessionId: string };

  const detail = await app.request(`/api/conversations/${sessionId}`, { headers: { cookie } });
  expect(detail.status).toBe(200);
  const body = (await detail.json()) as {
    conversation: {
      id: string;
      messages: Array<{ role: string; content: string; sequence: number }>;
    };
  };
  expect(body.conversation.id).toBe(sessionId);
  expect(body.conversation.messages.map((m) => m.content)).toEqual(['hello', 'hi back']);
  expect(body.conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
});

test('operator from another org cannot read another org conversations', async () => {
  const cookieA = await registerAndCookie('opA@example.com');
  const channelId = await createAgentAndChannel(cookieA);
  const post = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, widgetSessionId: 'wA', content: 'hi' }),
  });
  const { sessionId } = (await post.json()) as { sessionId: string };

  // Wipe operator + session rows so the next register creates a fresh org.
  const db = getDb(pg.url);
  await db.execute(sql`TRUNCATE TABLE "session", "user", "org" RESTART IDENTITY CASCADE`);

  const cookieB = await registerAndCookie('opB@example.com');
  const list = await app.request('/api/conversations', { headers: { cookie: cookieB } });
  expect(((await list.json()) as { conversations: unknown[] }).conversations).toEqual([]);

  const detail = await app.request(`/api/conversations/${sessionId}`, { headers: { cookie: cookieB } });
  expect(detail.status).toBe(404);
});
