// POST /telegram/webhook/:botId — Telegram bot webhook for 1-on-1 chats.
//
// Resolves the channel from the bot id, dispatches the inbound user message
// through the same headless runtime the widget + SMS channels use, then
// sends the agent's reply back via the Telegram bot API. Group chats are
// out of scope at v1.0 — non-private updates are dropped.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { agent, channel, org } from '../db/schema.ts';
import { createHeadlessRuntime } from '../headless/runtime.ts';
import { createCredentialService } from '../credentials/service.ts';
import { telegramRoute } from './route.ts';
import type { FetchLike } from './telegram.ts';

const ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const BOT_TOKEN = '123456:ABCdefGHIjklMNOpqr';
const BOT_ID = '123456';

let pg: StartedPg;
let app: Hono;
let sessionRoot: string;
let sentMessages: Array<{ token: string; chatId: number; text: string }>;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-tg-rt-'));

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

  const telegramFetch: FetchLike = async (url, init) => {
    // URL is `https://api.telegram.org/bot{token}/sendMessage`. Pull the
    // token out so the test can confirm the call used the right one.
    const token = /\/bot([^/]+)\/sendMessage/.exec(url)?.[1] ?? '';
    const json = JSON.parse(String(init.body ?? '{}')) as { chat_id: number; text: string };
    sentMessages.push({ token, chatId: json.chat_id, text: json.text });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

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

async function seedTelegramChannel(): Promise<{ orgId: string; channelId: string }> {
  const db = getDb(pg.url);
  const credentials = createCredentialService({ db, encryptionKey: ENCRYPTION_KEY });
  const [o] = await db.insert(org).values({ name: 'o' }).returning();
  const [a] = await db
    .insert(agent)
    .values({ orgId: o!.id, name: 'a', persona: 'p', model: 'm' })
    .returning();
  const [ch] = await db
    .insert(channel)
    .values({ orgId: o!.id, kind: 'telegram', agentId: a!.id, address: BOT_ID })
    .returning();
  await credentials.set(o!.id, 'telegram', 'bot_token', BOT_TOKEN);
  return { orgId: o!.id, channelId: ch!.id };
}

function inboundUpdate(opts: {
  updateId: number;
  fromId: number;
  chatId: number;
  text: string;
  chatType?: 'private' | 'group' | 'supergroup' | 'channel';
  isBot?: boolean;
}) {
  return {
    update_id: opts.updateId,
    message: {
      message_id: opts.updateId,
      from: { id: opts.fromId, is_bot: opts.isBot ?? false, first_name: 'V' },
      chat: { id: opts.chatId, type: opts.chatType ?? 'private' },
      date: 1700000000,
      text: opts.text,
    },
  };
}

test('inbound: dispatches to agent, sends reply via Telegram bot API', async () => {
  await seedTelegramChannel();

  const res = await app.request(`/telegram/webhook/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      inboundUpdate({ updateId: 100, fromId: 555, chatId: 555, text: 'hello there' }),
    ),
  });
  expect(res.status).toBe(200);

  expect(sentMessages).toHaveLength(1);
  expect(sentMessages[0]!.token).toBe(BOT_TOKEN);
  expect(sentMessages[0]!.chatId).toBe(555);
  expect(sentMessages[0]!.text).toBe('echo:hello there');
});

test('inbound: same sender twice reuses the same agent session', async () => {
  const { orgId } = await seedTelegramChannel();
  await app.request(`/telegram/webhook/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      inboundUpdate({ updateId: 1, fromId: 777, chatId: 777, text: 'one' }),
    ),
  });
  await app.request(`/telegram/webhook/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      inboundUpdate({ updateId: 2, fromId: 777, chatId: 777, text: 'two' }),
    ),
  });

  const db = getDb(pg.url);
  const sessions = await db.execute<{ id: string }>(
    sql`SELECT id FROM agent_session WHERE org_id = ${orgId}`,
  );
  expect(sessions.length).toBe(1);
});

test('inbound: drops non-private chats (groups deferred to v1.1+)', async () => {
  await seedTelegramChannel();

  const res = await app.request(`/telegram/webhook/${BOT_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      inboundUpdate({
        updateId: 50,
        fromId: 1,
        chatId: -100,
        text: 'group msg',
        chatType: 'supergroup',
      }),
    ),
  });
  // Acknowledge so Telegram doesn't retry, but no agent dispatch + no reply.
  expect(res.status).toBe(200);
  expect(sentMessages).toHaveLength(0);
});

test('inbound: 404 when bot id is not provisioned for any channel', async () => {
  await seedTelegramChannel();
  const res = await app.request(`/telegram/webhook/999999`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      inboundUpdate({ updateId: 1, fromId: 1, chatId: 1, text: 'hi' }),
    ),
  });
  expect(res.status).toBe(404);
  expect(sentMessages).toHaveLength(0);
});
