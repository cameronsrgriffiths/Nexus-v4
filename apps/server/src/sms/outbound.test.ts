// POST /sms/send: operator-authenticated outbound proactive SMS.
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
import { smsRoute } from './route.ts';
import { signTwilioSignature, type FetchLike } from './twilio.ts';

const ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const TWILIO_NUMBER = '+15550000777';
const AUTH_TOKEN = 'shared_outbound_token';

let pg: StartedPg;
let app: Hono;
let sessionRoot: string;
let sentMessages: Array<{ from: string; to: string; body: string }>;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-sms-out-'));

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

  const twilioFetch: FetchLike = async (_url, init) => {
    const params = new URLSearchParams(String(init.body ?? ''));
    sentMessages.push({
      from: params.get('From') ?? '',
      to: params.get('To') ?? '',
      body: params.get('Body') ?? '',
    });
    return new Response(JSON.stringify({ sid: 'SMxxx' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };

  app.route('/api/auth', authRoute({ db }));
  app.route('/api/conversations', conversationsRoute({ db }));
  app.route('/sms', smsRoute({ db, credentials, runtime, twilioFetch }));
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
  // Pull the operator's org id straight from the DB so we can seed channel +
  // contact rows owned by the same org.
  const db = getDb(pg.url);
  const [row] = await db.execute<{ id: string }>(sql`SELECT id FROM org LIMIT 1`);
  return { orgId: row!.id, cookie };
}

async function seedSmsChannelAndContact(orgId: string, contactPhone: string) {
  const db = getDb(pg.url);
  const credentials = createCredentialService({ db, encryptionKey: ENCRYPTION_KEY });
  const [a] = await db
    .insert(agent)
    .values({ orgId, name: 'a', persona: 'p', model: 'm' })
    .returning();
  const [ch] = await db
    .insert(channel)
    .values({ orgId, kind: 'sms', agentId: a!.id, address: TWILIO_NUMBER })
    .returning();
  await credentials.set(orgId, 'twilio', 'auth_token', AUTH_TOKEN);
  await credentials.set(orgId, 'twilio', 'account_sid', 'ACoutbound');

  const [con] = await db.insert(contact).values({ orgId }).returning();
  await db
    .insert(identifier)
    .values({ contactId: con!.id, kind: 'phone', value: contactPhone });
  return { channelId: ch!.id, contactId: con!.id };
}

test('outbound send routes through the same session as a later inbound reply', async () => {
  const { orgId, cookie } = await registerOperator();
  const contactPhone = '+15558881111';
  const { channelId, contactId } = await seedSmsChannelAndContact(orgId, contactPhone);

  // 1. Operator sends outbound.
  const outboundRes = await app.request('/sms/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ channelId, contactId, content: 'Hi from us' }),
  });
  expect(outboundRes.status).toBe(200);
  const outbound = (await outboundRes.json()) as { sessionId: string };

  // Twilio call captured: from our number, to the contact's phone, with our content.
  expect(sentMessages).toHaveLength(1);
  expect(sentMessages[0]!.body).toBe('Hi from us');
  expect(sentMessages[0]!.to).toBe(contactPhone);

  // 2. Contact replies — Twilio inbound webhook fires.
  const url = 'http://localhost/sms/twilio/inbound';
  const params = {
    AccountSid: 'ACoutbound',
    From: contactPhone,
    To: TWILIO_NUMBER,
    Body: 'thanks',
  };
  const inboundRes = await app.request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signTwilioSignature(url, params, AUTH_TOKEN),
    },
    body: new URLSearchParams(params).toString(),
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

test('outbound: rejects unauthenticated request', async () => {
  const res = await app.request('/sms/send', {
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
  const { orgId: orgA, cookie: cookieA } = await registerOperator();
  await seedSmsChannelAndContact(orgA, '+15558882222');

  // Another org's SMS channel.
  const db = getDb(pg.url);
  const [orgB] = await db.insert(org).values({ name: 'B' }).returning();
  const [agB] = await db
    .insert(agent)
    .values({ orgId: orgB!.id, name: 'b', persona: 'p', model: 'm' })
    .returning();
  const [chB] = await db
    .insert(channel)
    .values({ orgId: orgB!.id, kind: 'sms', agentId: agB!.id, address: '+15550009999' })
    .returning();
  const [conB] = await db.insert(contact).values({ orgId: orgB!.id }).returning();
  await db
    .insert(identifier)
    .values({ contactId: conB!.id, kind: 'phone', value: '+15558883333' });

  const res = await app.request('/sms/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ channelId: chB!.id, contactId: conB!.id, content: 'x' }),
  });
  expect(res.status).toBe(404);
});

test('outbound: 409 when contact has do_not_contact set', async () => {
  const { orgId, cookie } = await registerOperator();
  const { channelId, contactId } = await seedSmsChannelAndContact(orgId, '+15558884444');
  const db = getDb(pg.url);
  await db.execute(sql`UPDATE contact SET do_not_contact = true WHERE id = ${contactId}`);

  const res = await app.request('/sms/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ channelId, contactId, content: 'x' }),
  });
  expect(res.status).toBe(409);
  expect(sentMessages).toHaveLength(0);
});
