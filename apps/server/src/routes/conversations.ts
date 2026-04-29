// Operator-facing conversation read API.
//
// Lists agent sessions for the operator's org and returns the message log for
// a single session. This is the placeholder timeline the slice ships; #28
// replaces it with the full operator timeline.

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  agent,
  agentMessage,
  agentSession,
  channel,
  session,
  user,
} from '../db/schema.ts';

const SESSION_COOKIE = 'nexus_session';

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
