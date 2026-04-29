import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agent, session, user } from '../db/schema.ts';

const SESSION_COOKIE = 'nexus_session';

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
    return c.json({ agents: rows.map(toApi) }, 200);
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
    return c.json({ agent: toApi(created!) }, 201);
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
    return c.json({ agent: toApi(updated) }, 200);
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

function toApi(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    model: row.model,
    runtimeMode: row.runtimeMode,
    voiceEnabled: row.voiceEnabled,
  };
}

async function resolveOrgId(c: Context, db: PostgresJsDatabase): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db
    .select({ orgId: user.orgId, expiresAt: session.expiresAt })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(eq(session.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.orgId;
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
