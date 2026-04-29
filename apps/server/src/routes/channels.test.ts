// Operator channels API.
//
// `POST /api/channels/sms` connects a Twilio number to an agent: stores the
// account_sid + auth_token in the per-org credential store and creates an
// SMS channel row keyed on the phone number.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { createCredentialService } from '../credentials/service.ts';
import { authRoute } from './auth.ts';
import { agentsRoute } from './agents.ts';
import { channelsRoute } from './channels.ts';

const ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

let pg: StartedPg;
let app: Hono;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  app = new Hono();
  const db = getDb(pg.url);
  const credentials = createCredentialService({ db, encryptionKey: ENCRYPTION_KEY });
  app.route('/api/auth', authRoute({ db }));
  app.route('/api/agents', agentsRoute({ db }));
  app.route('/api/channels', channelsRoute({ db, credentials }));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(
    sql`TRUNCATE TABLE "agent_message", "agent_session", "identifier", "contact", "channel", "credential", "agent", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );
});

async function register(): Promise<{ cookie: string }> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `op+${crypto.randomUUID()}@example.com`,
      password: 'hunter2hunter2',
    }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { cookie: /nexus_session=[^;]+/.exec(setCookie)![0] };
}

async function createAgent(cookie: string): Promise<string> {
  const res = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'a', persona: 'p', model: 'm', voiceEnabled: false }),
  });
  const { agent } = (await res.json()) as { agent: { id: string } };
  return agent.id;
}

test('POST /api/channels/sms: stores creds + creates SMS channel', async () => {
  const { cookie } = await register();
  const agentId = await createAgent(cookie);

  const res = await app.request('/api/channels/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      agentId,
      twilioAccountSid: 'AC1234567890abcdef',
      twilioAuthToken: 'auth-token-secret',
      phoneNumber: '+15555550100',
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { channel: { id: string; kind: string; address: string } };
  expect(body.channel.kind).toBe('sms');
  expect(body.channel.address).toBe('+15555550100');

  // Listed via /api/agents (existing list endpoint surfaces channels for the UI).
  const list = await app.request('/api/agents', { headers: { cookie } });
  const { agents } = (await list.json()) as {
    agents: Array<{ id: string; smsChannel: { id: string; phoneNumber: string } | null }>;
  };
  const a = agents.find((x) => x.id === agentId)!;
  expect(a.smsChannel).not.toBeNull();
  expect(a.smsChannel!.phoneNumber).toBe('+15555550100');
});

test('POST /api/channels/sms: rejects when not authenticated', async () => {
  const res = await app.request('/api/channels/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId: '00000000-0000-0000-0000-000000000000',
      twilioAccountSid: 'AC',
      twilioAuthToken: 't',
      phoneNumber: '+15555550000',
    }),
  });
  expect(res.status).toBe(401);
});

test('POST /api/channels/sms: 404 when agent belongs to another org', async () => {
  const { cookie: cookieA } = await register();
  // Wipe the operator's auth so we get a fresh org for B.
  const db = getDb(pg.url);
  const [otherAgent] = await db.execute<{ id: string }>(
    sql`INSERT INTO org (name) VALUES ('B') RETURNING id`,
  );
  const orgB = otherAgent!.id;
  const [agB] = await db.execute<{ id: string }>(
    sql`INSERT INTO agent (org_id, name, persona, model) VALUES (${orgB}, 'b', 'p', 'm') RETURNING id`,
  );

  const res = await app.request('/api/channels/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieA },
    body: JSON.stringify({
      agentId: agB!.id,
      twilioAccountSid: 'AC',
      twilioAuthToken: 't',
      phoneNumber: '+15555550199',
    }),
  });
  expect(res.status).toBe(404);
});

test('POST /api/channels/sms: refuses to attach the same number twice', async () => {
  const { cookie } = await register();
  const agentId = await createAgent(cookie);
  const first = await app.request('/api/channels/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      agentId,
      twilioAccountSid: 'AC',
      twilioAuthToken: 't',
      phoneNumber: '+15555550123',
    }),
  });
  expect(first.status).toBe(201);
  const second = await app.request('/api/channels/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      agentId,
      twilioAccountSid: 'AC',
      twilioAuthToken: 't',
      phoneNumber: '+15555550123',
    }),
  });
  expect(second.status).toBe(409);
});
