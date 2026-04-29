// Widget channel: the public inbound endpoint a browser SDK posts to.
//
// Validates the body, dispatches to the headless runtime, and returns the
// session id + assistant reply. CORS is open (`*`) on this route since the
// widget runs on third-party origins; later slices can scope CORS per
// channel installation.

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { channel as channelTable } from '../db/schema.ts';
import { createHeadlessRuntime, type InvokeAgent } from '../headless/runtime.ts';

const Body = v.object({
  channelId: v.pipe(v.string(), v.uuid()),
  widgetSessionId: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  content: v.pipe(v.string(), v.minLength(1), v.maxLength(8000)),
});

type Deps = {
  db: PostgresJsDatabase;
  sessionRoot: string;
  invokeAgent: InvokeAgent;
};

export function widgetRoute({ db, sessionRoot, invokeAgent }: Deps) {
  const router = new Hono();
  const runtime = createHeadlessRuntime({ db, sessionRoot, invokeAgent });

  router.use('*', async (c, next) => {
    c.header('access-control-allow-origin', '*');
    c.header('access-control-allow-methods', 'POST, OPTIONS');
    c.header('access-control-allow-headers', 'content-type');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  router.post('/messages', async (c) => {
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(Body, json);
    if (!parsed.success) {
      return c.json({ error: 'invalid_widget_message_shape' }, 400);
    }
    const { channelId, widgetSessionId, content } = parsed.output;

    // Confirm the channel exists and is a widget channel before invoking the
    // runtime. The runtime's resolveSession would otherwise throw mid-turn.
    const [ch] = await db
      .select({ id: channelTable.id, kind: channelTable.kind })
      .from(channelTable)
      .where(eq(channelTable.id, channelId))
      .limit(1);
    if (!ch || ch.kind !== 'widget') {
      return c.json({ error: 'channel_not_found' }, 404);
    }

    const result = await runtime.handleInbound({
      channelId,
      identifierKind: 'widget_session_id',
      identifierValue: widgetSessionId,
      content,
    });
    return c.json({ sessionId: result.sessionId, reply: result.reply }, 200);
  });

  return router;
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
