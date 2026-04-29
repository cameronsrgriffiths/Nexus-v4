// POST /api/email/channels: operator connects an email channel + persists the
// org's Mailtrap creds via the credential service.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { agent, channel, org, session, user } from '../db/schema.ts';
import { createCredentialService } from '../credentials/service.ts';
import { emailRoute } from './email.ts';

const TEST_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

let pg: StartedPg;
let app: Hono;
let cookie: string;
let agentId: string;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(
    sql`TRUNCATE TABLE "channel_inbound_seen", "agent_message", "agent_session", "identifier", "contact", "channel", "agent", "credential", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );

  // Seed an org+user+session so resolveOrgId returns a real org.
  const [o] = await db.insert(org).values({ name: 'op' }).returning();
  const [u] = await db
    .insert(user)
    .values({ orgId: o!.id, email: 'op@example.com', passwordHash: 'x' })
    .returning();
  const token = crypto.randomUUID();
  const tokenHash = new Bun.CryptoHasher('sha256').update(token).digest('hex');
  await db.insert(session).values({
    userId: u!.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60_000),
  });
  cookie = `nexus_session=${token}`;

  const [a] = await db
    .insert(agent)
    .values({ orgId: o!.id, name: 'a', persona: 'p', model: 'm' })
    .returning();
  agentId = a!.id;

  const credentials = createCredentialService({ db, encryptionKey: TEST_KEY });
  app = new Hono();
  app.route('/api/email', emailRoute({ db, credentials }));
});

test('POST /api/email/channels: creates channel and stores all four mailtrap creds', async () => {
  const res = await app.request('/api/email/channels', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      agentId,
      emailAddress: 'agent@nexus.test',
      mailtrapInboxId: 'inbox-1',
      mailtrapAccountId: 'acc-1',
      mailtrapApiToken: 'token-1',
      mailtrapSmtpUser: 'smtp-user',
      mailtrapSmtpPass: 'smtp-pass',
    }),
  });
  expect(res.status).toBe(201);

  const db = getDb(pg.url);
  const channels = await db.select().from(channel);
  expect(channels.length).toBe(1);
  expect(channels[0]!.kind).toBe('email');
  expect(channels[0]!.emailAddress).toBe('agent@nexus.test');
  expect(channels[0]!.mailtrapInboxId).toBe('inbox-1');

  const credentials = createCredentialService({
    db,
    encryptionKey: TEST_KEY,
  });
  expect(await credentials.get(channels[0]!.orgId, 'mailtrap', 'account_id')).toBe('acc-1');
  expect(await credentials.get(channels[0]!.orgId, 'mailtrap', 'api_token')).toBe('token-1');
  expect(await credentials.get(channels[0]!.orgId, 'mailtrap', 'smtp_user')).toBe('smtp-user');
  expect(await credentials.get(channels[0]!.orgId, 'mailtrap', 'smtp_pass')).toBe('smtp-pass');
});

test('POST /api/email/channels: 401 without session cookie', async () => {
  const res = await app.request('/api/email/channels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId,
      emailAddress: 'agent@nexus.test',
      mailtrapInboxId: 'i',
      mailtrapAccountId: 'a',
      mailtrapApiToken: 't',
      mailtrapSmtpUser: 'u',
      mailtrapSmtpPass: 'p',
    }),
  });
  expect(res.status).toBe(401);
});

test('POST /api/email/channels: 404 if agent belongs to another org', async () => {
  const db = getDb(pg.url);
  // Make an agent in a different org.
  const [other] = await db.insert(org).values({ name: 'other' }).returning();
  const [otherAgent] = await db
    .insert(agent)
    .values({ orgId: other!.id, name: 'x', persona: 'y', model: 'z' })
    .returning();

  const res = await app.request('/api/email/channels', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      agentId: otherAgent!.id,
      emailAddress: 'agent@nexus.test',
      mailtrapInboxId: 'i',
      mailtrapAccountId: 'a',
      mailtrapApiToken: 't',
      mailtrapSmtpUser: 'u',
      mailtrapSmtpPass: 'p',
    }),
  });
  expect(res.status).toBe(404);
});

test('POST /api/email/channels: 400 for malformed payload', async () => {
  const res = await app.request('/api/email/channels', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ agentId, emailAddress: 'not-an-email' }),
  });
  expect(res.status).toBe(400);
});
