// Operator-facing email-channel routes.
//
//   POST /api/email/channels
//     Connect an email channel for an agent. Stores the org's Mailtrap
//     credentials via the credential service (#4) and creates the channel row
//     with the inbox id + reply-from address.
//
// Mailtrap creds are scoped per-org: connecting a second email channel for
// the same org overwrites the credentials (intentional — most orgs use one
// Mailtrap project). Each channel has its own inbox id, kept on the channel
// row.

import { Hono } from 'hono';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agent, channel } from '../db/schema.ts';
import { resolveOrgId } from './_session-cookie.ts';
import type { CredentialService } from '../credentials/service.ts';

const ConnectInput = v.object({
  agentId: v.pipe(v.string(), v.uuid()),
  // The address the agent sends from. Real use: matches the verified domain
  // on the operator's Mailtrap account.
  emailAddress: v.pipe(v.string(), v.email()),
  mailtrapInboxId: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  mailtrapAccountId: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  mailtrapApiToken: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  mailtrapSmtpUser: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  mailtrapSmtpPass: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
});

type Deps = { db: PostgresJsDatabase; credentials: CredentialService };

export function emailRoute({ db, credentials }: Deps) {
  const router = new Hono();

  router.post('/channels', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);

    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(ConnectInput, json);
    if (!parsed.success) return c.json({ error: 'invalid_email_channel_shape' }, 400);
    const input = parsed.output;

    // Confirm the agent belongs to this org before binding a channel to it.
    const [a] = await db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.id, input.agentId), eq(agent.orgId, orgId)))
      .limit(1);
    if (!a) return c.json({ error: 'agent_not_found' }, 404);

    await credentials.set(orgId, 'mailtrap', 'account_id', input.mailtrapAccountId);
    await credentials.set(orgId, 'mailtrap', 'api_token', input.mailtrapApiToken);
    await credentials.set(orgId, 'mailtrap', 'smtp_user', input.mailtrapSmtpUser);
    await credentials.set(orgId, 'mailtrap', 'smtp_pass', input.mailtrapSmtpPass);

    const [created] = await db
      .insert(channel)
      .values({
        orgId,
        kind: 'email',
        agentId: input.agentId,
        emailAddress: input.emailAddress,
        mailtrapInboxId: input.mailtrapInboxId,
      })
      .returning();
    return c.json(
      {
        channel: {
          id: created!.id,
          kind: created!.kind,
          agentId: created!.agentId,
          emailAddress: created!.emailAddress,
          mailtrapInboxId: created!.mailtrapInboxId,
        },
      },
      201,
    );
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
