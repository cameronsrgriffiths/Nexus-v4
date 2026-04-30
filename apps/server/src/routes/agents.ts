import { Hono } from 'hono';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agent, channel } from '../db/schema.ts';
import { resolveOrgId } from './_session-cookie.ts';

// Headless is the only mode the UI exposes at this slice. The schema accepts
// `dedicated` so a later slice can flip it on without a migration.
const AgentInput = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  persona: v.pipe(v.string(), v.minLength(1), v.maxLength(8_000)),
  model: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  voiceEnabled: v.boolean(),
});

type AgentRow = typeof agent.$inferSelect;

type Deps = { db: PostgresJsDatabase };

export function agentsRoute({ db }: Deps) {
  const router = new Hono();

  router.get('/', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const rows = await db.select().from(agent).where(eq(agent.orgId, orgId));
    const channels = await db
      .select()
      .from(channel)
      .where(eq(channel.orgId, orgId));
    return c.json(
      { agents: rows.map((row) => toApi(row, channels)) },
      200,
    );
  });

  router.post('/', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(AgentInput, json);
    if (!parsed.success) {
      return c.json({ error: 'invalid_agent_shape' }, 400);
    }
    const { name, persona, model, voiceEnabled } = parsed.output;
    const [created] = await db
      .insert(agent)
      .values({ orgId, name, persona, model, voiceEnabled })
      .returning();
    // Auto-provision a widget channel: every agent ships with a widget by
    // default. SMS lands later via POST /api/channels/sms.
    const [widgetChannel] = await db
      .insert(channel)
      .values({ orgId, kind: 'widget', agentId: created!.id })
      .returning();
    return c.json({ agent: toApi(created!, [widgetChannel!]) }, 201);
  });

  router.patch('/:id', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const id = c.req.param('id');
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(AgentInput, json);
    if (!parsed.success) {
      return c.json({ error: 'invalid_agent_shape' }, 400);
    }
    const { name, persona, model, voiceEnabled } = parsed.output;
    const [updated] = await db
      .update(agent)
      .set({ name, persona, model, voiceEnabled, updatedAt: new Date() })
      .where(and(eq(agent.id, id), eq(agent.orgId, orgId)))
      .returning();
    if (!updated) return c.json({ error: 'not_found' }, 404);
    const channels = await db
      .select()
      .from(channel)
      .where(eq(channel.agentId, updated.id));
    return c.json({ agent: toApi(updated, channels) }, 200);
  });

  router.delete('/:id', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const id = c.req.param('id');
    const deleted = await db
      .delete(agent)
      .where(and(eq(agent.id, id), eq(agent.orgId, orgId)))
      .returning({ id: agent.id });
    if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  return router;
}

type ChannelRow = typeof channel.$inferSelect;

function toApi(row: AgentRow, channels: ChannelRow[]) {
  // The UI expects per-channel slots so it can render "connect" vs "connected"
  // without filtering on its end.
  const widget = channels.find((c) => c.kind === 'widget' && c.agentId === row.id) ?? null;
  const sms = channels.find((c) => c.kind === 'sms' && c.agentId === row.id) ?? null;
  const telegram =
    channels.find((c) => c.kind === 'telegram' && c.agentId === row.id) ?? null;
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    model: row.model,
    runtimeMode: row.runtimeMode,
    voiceEnabled: row.voiceEnabled,
    widgetChannelId: widget?.id ?? null,
    smsChannel: sms ? { id: sms.id, phoneNumber: sms.address ?? '' } : null,
    telegramChannel: telegram ? { id: telegram.id, botId: telegram.address ?? '' } : null,
  };
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
