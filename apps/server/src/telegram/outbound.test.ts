// POST /telegram/send: operator-authenticated outbound proactive Telegram send.
//
// PRD invariant #10: outbound and inbound resolve through the same
// `resolveSession` code path, so when a contact replies, the inbound webhook
// finds the same session — proactive sends and the contact's reply share
// one thread.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { agent, channel, contact, identifier, org } from '../db/schema.ts';
import { createHeadlessRuntime } from '../headless/runtime.ts';
import { createCredentialService } from '../credentials/service.ts';
import { authRoute } from '../routes/auth.ts';
import { conversationsRoute } from '../routes/conversations.ts';
import { telegramRoute } from './route.ts';
import type { FetchLike } from './telegram.ts';

const ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const BOT_TOKEN = '987654:OutboundXYZ';
const BOT_ID = '987654';

let pg: StartedPg;
let app: Hono;
let sessionRoot: string;
let sentMessages: Array<{ chatId: number; text: string }>;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-tg-out-'));

  app = new Hono();
  const db = getDb(pg.url);
  sentMessages = [];
  const credentials = createCredentialService({ db, encryptionKey: ENCRYPTION_KEY });
  const runtime = createHeadlessRuntime({
    db,
    sessionRoot,
    invokeAgent: async (_opts, history) => {
      const last = history[history.length - 1]!;
      return `echo:${last.content}`;
    },
  });

  const telegramFetch: FetchLike = async (_url, init) => {
    const json = JSON.parse(String(init.body ?? '{}')) as { chat_id: number; text: string };
    sentMessages.push({ chatId: json.chat_id, text: json.text });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  app.route('/api/auth', authRoute({ db }));
  app.route('/api/conversations', conversationsRoute({ db }));
  app.route('/telegram', telegramRoute({ db, credentials, runtime, telegramFetch }));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
  await rm(sessionRoot, { recursive: true, force: true });
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(
    sql`TRUNCATE TABLE "agent_message", "agent_session", "identifier", "contact", "channel", "credential", "agent", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );
  sentMessages.length = 0;
});

async function registerOperator(): Promise<{ orgId: string; cookie: string }> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `op+${crypto.randomUUID()}@example.com`,
      password: 'hunter2hunter2',
    }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const cookie = /nexus_session=[^;]+/.exec(setCookie)![0];
  const db = getDb(pg.url);
  const [row] = await db.execute<{ id: string }>(sql`SELECT id FROM org LIMIT 1`);
  return { orgId: row!.id, cookie };
}

async function seedChannelAndContact(orgId: string, telegramUserId: string) {
  const db = getDb(pg.url);
  const credentials = createCredentialService({ db, encryptionKey: ENCRYPTION_KEY });
  const [a] = await db
    .insert(agent)
    .values({ orgId, name: 'a', persona: 'p', model: 'm' })
    .returning();
  const [ch] = await db
    .insert(channel)
    .values({ orgId, kind: 'telegram', agentId: a!.id, address: BOT_ID })
    .returning();
  await credentials.set(orgId, 'telegram', 'bot_token', BOT_TOKEN);

  const [con] = await db.insert(contact).values({ orgId }).returning();
  await db
    .insert(identifier)
    .values({ contactId: con!.id, kind: 'telegram_user_id', value: telegramUserId });
  return { channelId: ch!.id, contactId: con!.id };
}

test('outbound + reply: both turns in the same session', async () => {
  const { orgId, cookie } = await registerOperator();
  const telegramUserId = '424242';
  const { channelId, contactId } = await seedChannelAndContact(orgId, telegramUserId);

  // 1. Operator sends outbound proactive Telegram message.
  const outboundRes = await app.request('/telegram/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ channelId, contactId, content: 'Hi from us' }),
  });
  expect(outboundRes.status).toBe(200);
  const outbound = (await outboundRes.json()) as { sessionId: string };

  // Telegram call captured: chat id is the contact's telegram user id.
  expect(sentMessages).toHaveLength(1);
  expect(sentMessages[0]!.text).toBe('Hi from us');
  expect(sentMessages[0]!.chatId).toBe(424242);

  // 2. Contact replies — Telegram inbound webhook fires.
  const inboundRes = await app.request(`/telegram/webhook/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 424242, is_bot: false },
        chat: { id: 424242, type: 'private' },
        date: 1700000001,
        text: 'thanks',
      },
    }),
  });
  expect(inboundRes.status).toBe(200);

  // 3. Both messages land in the SAME session.
  const detail = await app.request(`/api/conversations/${outbound.sessionId}`, {
    headers: { cookie },
  });
  expect(detail.status).toBe(200);
  const body = (await detail.json()) as {
    conversation: { messages: Array<{ role: string; content: string }> };
  };
  // Outbound assistant message, then inbound user message, then echoed agent reply.
  expect(body.conversation.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
    'assistant:Hi from us',
    'user:thanks',
    'assistant:echo:thanks',
  ]);
});

test('outbound: 401 when not authenticated', async () => {
  const res = await app.request('/telegram/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channelId: '00000000-0000-0000-0000-000000000000',
      contactId: '00000000-0000-0000-0000-000000000000',
      content: 'x',
    }),
  });
  expect(res.status).toBe(401);
});

test('outbound: 404 when channel belongs to another org', async () => {
  const { cookie: cookieA } = await registerOperator();

  // Another org's Telegram channel.
  const db = getDb(pg.url);
  const [orgB] = await db.insert(org).values({ name: 'B' }).returning();
  const [agB] = await db
    .insert(agent)
    .values({ orgId: orgB!.id, name: 'b', persona: 'p', model: 'm' })
    .returning();
  const [chB] = await db
    .insert(channel)
    .values({ orgId: orgB!.id, kind: 'telegram', agentId: agB!.id, address: '111222' })
    .returning();
  const [conB] = await db.insert(contact).values({ orgId: orgB!.id }).returning();
  await db
    .insert(identifier)
    .values({ contactId: conB!.id, kind: 'telegram_user_id', value: '99' });

  const res = await app.request('/telegram/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ channelId: chB!.id, contactId: conB!.id, content: 'x' }),
  });
  expect(res.status).toBe(404);
});

test('outbound: 409 when contact has do_not_contact set', async () => {
  const { orgId, cookie } = await registerOperator();
  const { channelId, contactId } = await seedChannelAndContact(orgId, '525252');
  const db = getDb(pg.url);
  await db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${contactId}`);

  const res = await app.request('/telegram/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ channelId, contactId, content: 'x' }),
  });
  expect(res.status).toBe(409);
  expect(sentMessages).toHaveLength(0);
});
