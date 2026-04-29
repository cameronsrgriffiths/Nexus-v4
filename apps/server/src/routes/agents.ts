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
    const rows = await db
      .select({
        agent,
        widgetChannelId: channel.id,
      })
      .from(agent)
      .leftJoin(
        channel,
        and(eq(channel.agentId, agent.id), eq(channel.kind, 'widget')),
      )
      .where(eq(agent.orgId, orgId));
    return c.json(
      { agents: rows.map((r) => toApi(r.agent, r.widgetChannelId ?? null)) },
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
    // default. Future slices can let the operator manage channels explicitly;
    // for now, the agent and its widget are 1:1 so the operator can grab the
    // channel id and embed the widget immediately.
    const [widgetChannel] = await db
      .insert(channel)
      .values({ orgId, kind: 'widget', agentId: created!.id })
      .returning();
    return c.json({ agent: toApi(created!, widgetChannel!.id) }, 201);
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
    const [widgetChannel] = await db
      .select({ id: channel.id })
      .from(channel)
      .where(and(eq(channel.agentId, updated.id), eq(channel.kind, 'widget')))
      .limit(1);
    return c.json({ agent: toApi(updated, widgetChannel?.id ?? null) }, 200);
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

function toApi(row: AgentRow, widgetChannelId: string | null) {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    model: row.model,
    runtimeMode: row.runtimeMode,
    voiceEnabled: row.voiceEnabled,
    widgetChannelId,
  };
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
