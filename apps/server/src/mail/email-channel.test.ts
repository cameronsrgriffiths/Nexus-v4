// Email channel integration tests.
//
// Test 1 (inbound): a customer email arrives in the channel's Mailtrap inbox
//   → poll picks it up → agent replies → reply lands in the same inbox via
//   SMTP. Asserts the AC "send inbound email via Mailtrap test inbox → agent
//   replies → reply lands in Mailtrap test inbox".
//
// Test 2 (threading, invariant #10): an outbound-first send to a contact, then
//   the contact replies. Both turns must land in the same agent_session and
//   share the same email thread (In-Reply-To/References chain).

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { agent, channel, org } from '../db/schema.ts';
import { createHeadlessRuntime } from '../headless/runtime.ts';
import { createFakeMailtrapClient, type FakeMailtrapClient } from './fake-client.ts';
import { createEmailChannel } from './email-channel.ts';

let pg: StartedPg;
let sessionRoot: string;
const INBOX_ID = 'inbox-1';

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-email-rt-'));
}, 120_000);

afterAll(async () => {
  await closeDb();
  await pg.stop();
  await rm(sessionRoot, { recursive: true, force: true });
}, 60_000);

beforeEach(async () => {
  const db = getDb(pg.url);
  await db.execute(
    sql`TRUNCATE TABLE "channel_inbound_seen", "agent_message", "agent_session", "identifier", "contact", "channel", "agent", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );
});

async function seedEmailChannel(): Promise<{
  channelId: string;
  emailAddress: string;
}> {
  const db = getDb(pg.url);
  const [o] = await db.insert(org).values({ name: 'o' }).returning();
  const [a] = await db
    .insert(agent)
    .values({ orgId: o!.id, name: 'a', persona: 'p', model: 'm' })
    .returning();
  const emailAddress = 'agent@nexus.test';
  const [ch] = await db
    .insert(channel)
    .values({
      orgId: o!.id,
      kind: 'email',
      agentId: a!.id,
      emailAddress,
      mailtrapInboxId: INBOX_ID,
    })
    .returning();
  return { channelId: ch!.id, emailAddress };
}

function buildHarness(client: FakeMailtrapClient) {
  const db = getDb(pg.url);
  const runtime = createHeadlessRuntime({
    db,
    sessionRoot,
    invokeAgent: async (_options, history) => {
      const last = history[history.length - 1]!;
      return `Echo: ${last.content}`;
    },
  });
  return createEmailChannel({ db, client, runtime });
}

test('inbound email → agent reply → reply lands in the inbox', async () => {
  const { channelId, emailAddress } = await seedEmailChannel();
  const client = createFakeMailtrapClient({ sendInboxId: INBOX_ID });
  const channel = buildHarness(client);

  client.injectInbound(INBOX_ID, {
    from: 'visitor@example.com',
    to: emailAddress,
    subject: 'Hi there',
    text: 'hello',
    messageId: '<visitor-1@example.com>',
  });

  await channel.pollChannel(channelId);

  const inbox = client.inboxSnapshot(INBOX_ID);
  // The injected inbound + the assistant's outbound reply.
  expect(inbox.length).toBe(2);
  const reply = inbox.find((m) => m.from === emailAddress);
  expect(reply).toBeDefined();
  expect(reply!.to).toBe('visitor@example.com');
  expect(reply!.text).toBe('Echo: hello');
  expect(reply!.subject).toBe('Re: Hi there');
  expect(reply!.inReplyTo).toBe('<visitor-1@example.com>');
  expect(reply!.references).toContain('<visitor-1@example.com>');
});

test('repeat poll does not re-dispatch the same inbound message', async () => {
  const { channelId, emailAddress } = await seedEmailChannel();
  const client = createFakeMailtrapClient({ sendInboxId: INBOX_ID });
  const channel = buildHarness(client);

  client.injectInbound(INBOX_ID, {
    from: 'visitor@example.com',
    to: emailAddress,
    subject: 'Hi',
    text: 'hello',
    messageId: '<visitor-1@example.com>',
  });

  await channel.pollChannel(channelId);
  await channel.pollChannel(channelId);

  // First poll: inbound + assistant reply = 2.
  // Second poll sees the assistant's outbound (skipped: from === channel
  // address) and the original inbound (dedup hit). No new mail.
  const inbox = client.inboxSnapshot(INBOX_ID);
  expect(inbox.length).toBe(2);
});

test('outbound send → operator reply: both turns in the same session, threaded', async () => {
  const { channelId, emailAddress } = await seedEmailChannel();
  const client = createFakeMailtrapClient({ sendInboxId: INBOX_ID });
  const channel = buildHarness(client);

  // 1. Agent initiates: outbound to the contact.
  const sent = await channel.sendOutbound({
    channelId,
    toEmail: 'operator@example.com',
    content: 'Are you available for a quick call?',
    subject: 'Quick question',
  });

  // 2. Operator replies (via their email client → routed back to our inbox).
  client.injectInbound(INBOX_ID, {
    from: 'operator@example.com',
    to: emailAddress,
    subject: 'Re: Quick question',
    text: 'Yes I am',
    messageId: '<operator-reply-1@example.com>',
    inReplyTo: sent.messageId,
    references: [sent.messageId],
  });

  // 3. Poll to ingest the reply.
  await channel.pollChannel(channelId);

  // The reply must thread into the SAME session that the outbound created.
  const db = getDb(pg.url);
  const messages = await db.execute<{
    sequence: number;
    role: string;
    content: string;
    external_id: string | null;
    session_id: string;
  }>(
    sql`SELECT sequence, role, content, external_id, session_id::text AS session_id FROM agent_message ORDER BY sequence`,
  );
  const sessionIds = new Set(messages.map((m) => m.session_id));
  expect(sessionIds.size).toBe(1);
  expect(sessionIds.has(sent.sessionId)).toBe(true);

  // Sequence: assistant outbound → user inbound → assistant follow-up.
  expect(messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
  expect(messages[0]!.external_id).toBe(sent.messageId);
  expect(messages[1]!.external_id).toBe('<operator-reply-1@example.com>');

  // The follow-up reply on the wire threads to the operator's reply.
  const latestSent = client
    .inboxSnapshot(INBOX_ID)
    .filter((m) => m.from === emailAddress)
    .pop();
  expect(latestSent!.inReplyTo).toBe('<operator-reply-1@example.com>');
  expect(latestSent!.references).toContain(sent.messageId);
  expect(latestSent!.references).toContain('<operator-reply-1@example.com>');
});
