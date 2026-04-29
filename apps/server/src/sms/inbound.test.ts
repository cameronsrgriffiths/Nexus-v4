// POST /sms/twilio/inbound: the Twilio webhook for inbound SMS.
//
// Verifies the request signature with the org's stored Twilio auth token,
// resolves the channel from the `To` phone number, runs the agent through
// the same headless runtime the widget uses, and sends the agent's reply
// back via the Twilio REST API. PRD invariant #10: outbound and inbound
// share the runtime's resolveSession code path.

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
import { authRoute } from '../routes/auth.ts';
import { conversationsRoute } from '../routes/conversations.ts';
import { smsRoute } from './route.ts';
import { signTwilioSignature, type FetchLike } from './twilio.ts';

const ENCRYPTION_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

let pg: StartedPg;
let app: Hono;
let sessionRoot: string;
let sentMessages: Array<{ from: string; to: string; body: string }>;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-sms-rt-'));

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

  app.route('/api/auth', authRoute({ db }));
  app.route('/api/conversations', conversationsRoute({ db }));
  app.route(
    '/sms',
    smsRoute({
      db,
      credentials,
      runtime,
      // Stub Twilio HTTP send — captures the call and returns Twilio's shape.
      twilioFetch: (async (url, init) => {
        const body = String(init.body ?? '');
        const params = new URLSearchParams(body);
        sentMessages.push({
          from: params.get('From') ?? '',
          to: params.get('To') ?? '',
          body: params.get('Body') ?? '',
        });
        // Confirm the basic-auth header is set so we'd actually authenticate.
        const auth = new Headers(init.headers ?? {}).get('authorization') ?? '';
        if (!auth.startsWith('Basic ')) {
          return new Response('no auth', { status: 401 });
        }
        return new Response(JSON.stringify({ sid: 'SM' + url.length }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }) satisfies FetchLike,
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
    sql`TRUNCATE TABLE "agent_message", "agent_session", "identifier", "contact", "channel", "credential", "agent", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );
  sentMessages.length = 0;
});

async function seedSmsChannel(opts: {
  twilioNumber: string;
  authToken: string;
  accountSid?: string;
}): Promise<{ orgId: string; channelId: string; agentId: string }> {
  const db = getDb(pg.url);
  const credentials = createCredentialService({ db, encryptionKey: ENCRYPTION_KEY });
  const [o] = await db.insert(org).values({ name: 'o' }).returning();
  const [a] = await db
    .insert(agent)
    .values({ orgId: o!.id, name: 'a', persona: 'p', model: 'm' })
    .returning();
  const [ch] = await db
    .insert(channel)
    .values({ orgId: o!.id, kind: 'sms', agentId: a!.id, address: opts.twilioNumber })
    .returning();
  await credentials.set(o!.id, 'twilio', 'auth_token', opts.authToken);
  await credentials.set(o!.id, 'twilio', 'account_sid', opts.accountSid ?? 'ACtestxxxxxxxxxx');
  return { orgId: o!.id, channelId: ch!.id, agentId: a!.id };
}

function postInbound(opts: {
  url: string;
  authToken: string;
  params: Record<string, string>;
  signatureOverride?: string;
}) {
  const sig = opts.signatureOverride ?? signTwilioSignature(opts.url, opts.params, opts.authToken);
  return app.request(opts.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': sig,
    },
    body: new URLSearchParams(opts.params).toString(),
  });
}

test('inbound SMS: verifies signature, dispatches to agent, sends reply via Twilio', async () => {
  const { twilioNumber, authToken } = {
    twilioNumber: '+15550000111',
    authToken: 'twilio_auth_token_value',
  };
  await seedSmsChannel({ twilioNumber, authToken });

  const url = 'http://localhost/sms/twilio/inbound';
  const params = {
    AccountSid: 'ACtestxxxxxxxxxx',
    MessageSid: 'SMabc',
    From: '+15551234567',
    To: twilioNumber,
    Body: 'hello there',
  };
  const res = await postInbound({ url, authToken, params });
  expect(res.status).toBe(200);

  // Twilio webhook expects an XML response (TwiML); empty <Response/> is the
  // "we'll send the reply via the REST API" idiom.
  const text = await res.text();
  expect(text).toMatch(/<Response\s*\/?>/);

  // The agent reply was sent back via Twilio with From=our number and To=sender.
  expect(sentMessages).toHaveLength(1);
  expect(sentMessages[0]!.from).toBe(twilioNumber);
  expect(sentMessages[0]!.to).toBe('+15551234567');
  expect(sentMessages[0]!.body).toBe('echo:hello there');
});

test('inbound SMS: rejects invalid signature with 403', async () => {
  await seedSmsChannel({ twilioNumber: '+15550000222', authToken: 'right_token' });
  const url = 'http://localhost/sms/twilio/inbound';
  const params = {
    AccountSid: 'AC',
    From: '+15551234567',
    To: '+15550000222',
    Body: 'hi',
  };
  const res = await postInbound({
    url,
    authToken: 'right_token',
    params,
    signatureOverride: 'definitely_not_the_signature',
  });
  expect(res.status).toBe(403);
  expect(sentMessages).toHaveLength(0);
});

test('inbound SMS: rejects unknown To number with 404', async () => {
  await seedSmsChannel({ twilioNumber: '+15550000333', authToken: 'tok' });
  const url = 'http://localhost/sms/twilio/inbound';
  const params = {
    AccountSid: 'AC',
    From: '+15551234567',
    To: '+15559999999', // not provisioned
    Body: 'hi',
  };
  // Sign it against a token the server can't even look up because no row matches.
  const res = await postInbound({ url, authToken: 'tok', params });
  expect(res.status).toBe(404);
  expect(sentMessages).toHaveLength(0);
});

test('inbound SMS reply is visible in the operator conversation view', async () => {
  // Register the operator first so we get an org-bound cookie, then re-use
  // that same org for the SMS channel. This mirrors how the operator UI
  // sees the inbound conversation through `/api/conversations`.
  const reg = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `op+${crypto.randomUUID()}@example.com`,
      password: 'hunter2hunter2',
    }),
  });
  const cookie = /nexus_session=[^;]+/.exec(reg.headers.get('set-cookie') ?? '')![0];

  // Pull the operator's org id and seed the SMS channel into it.
  const db = getDb(pg.url);
  const [opOrg] = await db.execute<{ id: string }>(sql`SELECT id FROM org LIMIT 1`);
  const orgId = opOrg!.id;

  const credentials = createCredentialService({ db, encryptionKey: ENCRYPTION_KEY });
  const [a] = await db
    .insert(agent)
    .values({ orgId, name: 'Receptionist', persona: 'p', model: 'm' })
    .returning();
  const twilioNumber = '+15550000888';
  await db
    .insert(channel)
    .values({ orgId, kind: 'sms', agentId: a!.id, address: twilioNumber });
  const authToken = 'op-flow-token';
  await credentials.set(orgId, 'twilio', 'auth_token', authToken);
  await credentials.set(orgId, 'twilio', 'account_sid', 'ACopflow');

  const url = 'http://localhost/sms/twilio/inbound';
  const params = {
    AccountSid: 'ACopflow',
    From: '+15553334444',
    To: twilioNumber,
    Body: 'do you have appointments tomorrow?',
  };
  const res = await app.request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signTwilioSignature(url, params, authToken),
    },
    body: new URLSearchParams(params).toString(),
  });
  expect(res.status).toBe(200);

  // Operator opens the Conversations page: the SMS conversation lists, and
  // its detail view shows both the user message and the agent's reply.
  const list = await app.request('/api/conversations', { headers: { cookie } });
  const listBody = (await list.json()) as {
    conversations: Array<{ id: string; channelKind: string; agentName: string }>;
  };
  expect(listBody.conversations).toHaveLength(1);
  expect(listBody.conversations[0]!.channelKind).toBe('sms');
  expect(listBody.conversations[0]!.agentName).toBe('Receptionist');

  const detail = await app.request(
    `/api/conversations/${listBody.conversations[0]!.id}`,
    { headers: { cookie } },
  );
  const detailBody = (await detail.json()) as {
    conversation: { messages: Array<{ role: string; content: string }> };
  };
  expect(detailBody.conversation.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
    'user:do you have appointments tomorrow?',
    'assistant:echo:do you have appointments tomorrow?',
  ]);
});

test('inbound SMS: same sender twice reuses the same agent session', async () => {
  const twilioNumber = '+15550000444';
  const authToken = 'tok';
  const { orgId } = await seedSmsChannel({ twilioNumber, authToken });

  const url = 'http://localhost/sms/twilio/inbound';
  await postInbound({
    url,
    authToken,
    params: {
      AccountSid: 'AC',
      From: '+15551234567',
      To: twilioNumber,
      Body: 'one',
    },
  });
  await postInbound({
    url,
    authToken,
    params: {
      AccountSid: 'AC',
      From: '+15551234567',
      To: twilioNumber,
      Body: 'two',
    },
  });

  const db = getDb(pg.url);
  const sessions = await db.execute<{ id: string }>(
    sql`SELECT id FROM agent_session WHERE org_id = ${orgId}`,
  );
  expect(sessions.length).toBe(1);
});
