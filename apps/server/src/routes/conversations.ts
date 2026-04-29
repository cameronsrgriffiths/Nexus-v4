// Operator-facing conversation read API.
//
// Lists agent sessions for the operator's org and returns the message log for
// a single session. This is the placeholder timeline the slice ships; #28
// replaces it with the full operator timeline.

import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agent, agentMessage, agentSession, channel } from '../db/schema.ts';
import { resolveOrgId } from './_session-cookie.ts';

type Deps = { db: PostgresJsDatabase };

export function conversationsRoute({ db }: Deps) {
  const router = new Hono();

  router.get('/', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const rows = await db
      .select({
        id: agentSession.id,
        createdAt: agentSession.createdAt,
        agentName: agent.name,
        channelKind: channel.kind,
      })
      .from(agentSession)
      .innerJoin(agent, eq(agentSession.agentId, agent.id))
      .innerJoin(channel, eq(agentSession.channelId, channel.id))
      .where(eq(agentSession.orgId, orgId))
      .orderBy(desc(agentSession.createdAt));
    return c.json({ conversations: rows }, 200);
  });

  router.get('/:id', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const id = c.req.param('id');

    const [convo] = await db
      .select({
        id: agentSession.id,
        createdAt: agentSession.createdAt,
        agentName: agent.name,
        channelKind: channel.kind,
      })
      .from(agentSession)
      .innerJoin(agent, eq(agentSession.agentId, agent.id))
      .innerJoin(channel, eq(agentSession.channelId, channel.id))
      .where(and(eq(agentSession.id, id), eq(agentSession.orgId, orgId)))
      .limit(1);

    if (!convo) return c.json({ error: 'not_found' }, 404);

    const messages = await db
      .select({
        sequence: agentMessage.sequence,
        role: agentMessage.role,
        content: agentMessage.content,
        createdAt: agentMessage.createdAt,
      })
      .from(agentMessage)
      .where(eq(agentMessage.sessionId, id))
      .orderBy(asc(agentMessage.sequence));

    return c.json({ conversation: { ...convo, messages } }, 200);
  });

  return router;
}
