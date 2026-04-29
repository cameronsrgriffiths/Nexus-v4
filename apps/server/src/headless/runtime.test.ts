// Headless runtime: the single entry point for resolving contact + session
// from a channel identifier and dispatching a turn.
//
// PRD invariant #10: outbound and inbound code paths share this resolver, so
// outbound message-send (lands in #10) reuses it. We pin the lookup-or-create
// behavior here so a future caller can rely on it.

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { startPg, type StartedPg } from '../test-helpers/pg-container.ts';
import { agent, channel, org } from '../db/schema.ts';
import { createHeadlessRuntime } from './runtime.ts';

let pg: StartedPg;
let sessionRoot: string;

beforeAll(async () => {
  pg = await startPg();
  await runMigrations(pg.url);
  sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-rt-root-'));
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

async function seedWidgetChannel() {
  const db = getDb(pg.url);
  const [o] = await db.insert(org).values({ name: 'o' }).returning();
  const [a] = await db
    .insert(agent)
    .values({ orgId: o!.id, name: 'a', persona: 'be helpful', model: 'claude-haiku-test' })
    .returning();
  const [ch] = await db
    .insert(channel)
    .values({ orgId: o!.id, kind: 'widget', agentId: a!.id })
    .returning();
  return { orgId: o!.id, agentId: a!.id, channelId: ch!.id };
}

test('first message creates contact + identifier + session and stores user/assistant turns', async () => {
  const { channelId } = await seedWidgetChannel();
  const db = getDb(pg.url);

  const runtime = createHeadlessRuntime({
    db,
    sessionRoot,
    invokeAgent: async (_opts, history) => {
      const last = history[history.length - 1]!;
      return `echo:${last.content}`;
    },
  });

  const result = await runtime.handleInbound({
    channelId,
    identifierKind: 'widget_session_id',
    identifierValue: 'visitor-1',
    content: 'hello',
  });

  expect(result.reply).toBe('echo:hello');
  expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);

  const messages = await runtime.listMessages(result.sessionId);
  expect(messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'echo:hello' },
  ]);
});

test('second message from the same identifier reuses the contact and session', async () => {
  const { channelId } = await seedWidgetChannel();
  const db = getDb(pg.url);
  let calls = 0;
  const runtime = createHeadlessRuntime({
    db,
    sessionRoot,
    invokeAgent: async () => {
      calls += 1;
      return `r${calls}`;
    },
  });

  const a = await runtime.handleInbound({
    channelId,
    identifierKind: 'widget_session_id',
    identifierValue: 'returning',
    content: 'one',
  });
  const b = await runtime.handleInbound({
    channelId,
    identifierKind: 'widget_session_id',
    identifierValue: 'returning',
    content: 'two',
  });

  expect(a.sessionId).toBe(b.sessionId);
  const msgs = await runtime.listMessages(a.sessionId);
  expect(msgs.map((m) => m.content)).toEqual(['one', 'r1', 'two', 'r2']);
});

test('agent receives full prior history on each turn', async () => {
  const { channelId } = await seedWidgetChannel();
  const db = getDb(pg.url);
  let lastHistoryLen = 0;
  const runtime = createHeadlessRuntime({
    db,
    sessionRoot,
    invokeAgent: async (_opts, history) => {
      lastHistoryLen = history.length;
      return 'ok';
    },
  });

  await runtime.handleInbound({
    channelId,
    identifierKind: 'widget_session_id',
    identifierValue: 'h',
    content: 'first',
  });
  expect(lastHistoryLen).toBe(1);

  await runtime.handleInbound({
    channelId,
    identifierKind: 'widget_session_id',
    identifierValue: 'h',
    content: 'second',
  });
  // First turn: [user:first]
  // Persisted: [user:first, assistant:ok]
  // Second turn input: [user:first, assistant:ok, user:second] => 3
  expect(lastHistoryLen).toBe(3);
});

test('SDK options for each turn carry project-only setting sources and per-session cwd', async () => {
  const { channelId } = await seedWidgetChannel();
  const db = getDb(pg.url);
  const seen: Array<{ cwd: string; settingSources: string[] }> = [];
  const runtime = createHeadlessRuntime({
    db,
    sessionRoot,
    invokeAgent: async (opts) => {
      seen.push({ cwd: opts.cwd, settingSources: opts.settingSources });
      return 'ack';
    },
  });

  await runtime.handleInbound({
    channelId,
    identifierKind: 'widget_session_id',
    identifierValue: 'opts-check',
    content: 'hi',
  });

  expect(seen).toHaveLength(1);
  expect(seen[0]!.settingSources).toEqual(['project']);
  expect(seen[0]!.cwd.startsWith(sessionRoot)).toBe(true);
});
