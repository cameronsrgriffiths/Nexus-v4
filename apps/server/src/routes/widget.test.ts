// POST /widget/messages: the inbound widget channel.
//
// Resolves channel + identifier, persists the user turn, invokes the agent,
// persists the assistant turn, returns the reply. The runtime under it is
// the same shared resolver used by outbound send (PRD invariant #10).

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { agent, channel, org } from '../db/schema.ts';
import { widgetRoute } from './widget.ts';

let pg: StartedPg;
let app: Hono;
let sessionRoot: string;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-widget-rt-'));

  app = new Hono();
  const db = getDb(pg.url);
  app.route(
    '/widget',
    widgetRoute({
      db,
      sessionRoot,
      invokeAgent: async (_opts, history) => {
        const last = history[history.length - 1]!;
        return `echo:${last.content}`;
      },
    }),
  );
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

async function seedWidgetChannel(): Promise<string> {
  const db = getDb(pg.url);
  const [o] = await db.insert(org).values({ name: 'o' }).returning();
  const [a] = await db
    .insert(agent)
    .values({ orgId: o!.id, name: 'a', persona: 'p', model: 'm' })
    .returning();
  const [ch] = await db
    .insert(channel)
    .values({ orgId: o!.id, kind: 'widget', agentId: a!.id })
    .returning();
  return ch!.id;
}

test('POST /widget/messages: first message creates session and returns the reply', async () => {
  const channelId = await seedWidgetChannel();
  const res = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, widgetSessionId: 'visitor-1', content: 'hello' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { sessionId: string; reply: string };
  expect(body.reply).toBe('echo:hello');
  expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
});

test('POST /widget/messages: same widget session id reuses the agent session', async () => {
  const channelId = await seedWidgetChannel();
  const a = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, widgetSessionId: 'returning', content: 'one' }),
  });
  const b = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, widgetSessionId: 'returning', content: 'two' }),
  });
  const aBody = (await a.json()) as { sessionId: string };
  const bBody = (await b.json()) as { sessionId: string };
  expect(aBody.sessionId).toBe(bBody.sessionId);
});

test('POST /widget/messages: rejects unknown channel id', async () => {
  const res = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channelId: '00000000-0000-0000-0000-000000000000',
      widgetSessionId: 'x',
      content: 'hi',
    }),
  });
  expect(res.status).toBe(404);
});

test('POST /widget/messages: rejects bad payload with 400', async () => {
  const res = await app.request('/widget/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId: 'not-a-uuid', widgetSessionId: '', content: '' }),
  });
  expect(res.status).toBe(400);
});
