// PRD invariant #5: SDK sessions are append-only. Every write is appended;
// no reorders, no back-inserts. This test pins that contract: the store
// assigns monotonic sequence numbers and rejects any attempt to write at
// a non-monotonic sequence.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { createSessionStore, OutOfOrderWriteError } from './session-store.ts';
import { agentSession, agentMessage, agent, contact, identifier, channel, org } from '../db/schema.ts';

let pg: StartedPg;

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
    sql`TRUNCATE TABLE "agent_message", "agent_session", "identifier", "contact", "channel", "agent", "session", "user", "org" RESTART IDENTITY CASCADE`,
  );
});

async function seedSessionRow() {
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
  const [co] = await db.insert(contact).values({ orgId: o!.id }).returning();
  await db
    .insert(identifier)
    .values({ contactId: co!.id, kind: 'widget_session_id', value: 'w-1' });
  const [s] = await db
    .insert(agentSession)
    .values({ orgId: o!.id, agentId: a!.id, channelId: ch!.id, contactId: co!.id })
    .returning();
  return s!.id;
}

test('append assigns monotonic sequence numbers starting at 1', async () => {
  const store = createSessionStore({ db: getDb(pg.url) });
  const sid = await seedSessionRow();
  const a = await store.append(sid, { role: 'user', content: 'hello' });
  const b = await store.append(sid, { role: 'assistant', content: 'hi' });
  const c = await store.append(sid, { role: 'user', content: 'how are you' });
  expect(a.sequence).toBe(1);
  expect(b.sequence).toBe(2);
  expect(c.sequence).toBe(3);
});

test('append rejects an out-of-order write fast', async () => {
  const store = createSessionStore({ db: getDb(pg.url) });
  const sid = await seedSessionRow();
  await store.append(sid, { role: 'user', content: 'one' });
  await store.append(sid, { role: 'assistant', content: 'two' });
  // Try to write at sequence 2 again — would either reorder or back-insert.
  await expect(
    store.appendAt(sid, 2, { role: 'user', content: 'forced reorder' }),
  ).rejects.toBeInstanceOf(OutOfOrderWriteError);
});

test('list returns the messages in append order', async () => {
  const store = createSessionStore({ db: getDb(pg.url) });
  const sid = await seedSessionRow();
  await store.append(sid, { role: 'user', content: 'first' });
  await store.append(sid, { role: 'assistant', content: 'second' });
  const msgs = await store.list(sid);
  expect(msgs.map((m) => m.content)).toEqual(['first', 'second']);
  expect(msgs.map((m) => m.sequence)).toEqual([1, 2]);
});
