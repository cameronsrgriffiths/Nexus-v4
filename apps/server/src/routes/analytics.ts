// Operator analytics API. Returns three aggregations of `agent_message` rows
// for the operator's org:
//   - overTime: message count per UTC day (ascending)
//   - perChannel: message count per channel kind
//   - perAgent: message count per agent, ordered by descending count
//
// Rows are scoped via the agent_session.org_id join so the operator only sees
// their own org's traffic.

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveOrgId } from './_session-cookie.ts';

type Deps = { db: PostgresJsDatabase };

export function analyticsRoute({ db }: Deps) {
  const router = new Hono();

  router.get('/', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);

    // Per-day: format the day as YYYY-MM-DD so the chart axis is plain text
    // and time-zone-stable across the API boundary.
    const overTimeRows = await db.execute<{ day: string; count: string }>(sql`
      SELECT to_char(date_trunc('day', m.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             count(*)::text AS count
      FROM agent_message m
      INNER JOIN agent_session s ON s.id = m.session_id
      WHERE s.org_id = ${orgId}
      GROUP BY day
      ORDER BY day ASC
    `);

    const perChannelRows = await db.execute<{ channel_kind: string; count: string }>(sql`
      SELECT c.kind AS channel_kind, count(*)::text AS count
      FROM agent_message m
      INNER JOIN agent_session s ON s.id = m.session_id
      INNER JOIN channel c ON c.id = s.channel_id
      WHERE s.org_id = ${orgId}
      GROUP BY c.kind
      ORDER BY count(*) DESC, c.kind ASC
    `);

    const perAgentRows = await db.execute<{
      agent_id: string;
      agent_name: string;
      count: string;
    }>(sql`
      SELECT a.id AS agent_id, a.name AS agent_name, count(*)::text AS count
      FROM agent_message m
      INNER JOIN agent_session s ON s.id = m.session_id
      INNER JOIN agent a ON a.id = s.agent_id
      WHERE s.org_id = ${orgId}
      GROUP BY a.id, a.name
      ORDER BY count(*) DESC, a.name ASC
    `);

    return c.json(
      {
        overTime: overTimeRows.map((r) => ({ day: r.day, count: Number(r.count) })),
        perChannel: perChannelRows.map((r) => ({
          channelKind: r.channel_kind,
          count: Number(r.count),
        })),
        perAgent: perAgentRows.map((r) => ({
          agentId: r.agent_id,
          agentName: r.agent_name,
          count: Number(r.count),
        })),
      },
      200,
    );
  });

  return router;
}
