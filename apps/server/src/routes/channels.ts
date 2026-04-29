// Operator channels API.
//
// `POST /api/channels/sms` connects a Twilio phone number to an agent:
//   - persists `twilio.account_sid` + `twilio.auth_token` in the per-org
//     credential store (slice #4),
//   - inserts an SMS `channel` row keyed on the phone number for inbound
//     resolution.
//
// The operator UI uses this endpoint to wire up SMS. The Twilio webhook URL
// the operator pastes into Twilio's console points at the public
// `/sms/twilio/inbound` route.

import { Hono } from 'hono';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agent as agentTable, channel as channelTable } from '../db/schema.ts';
import type { CredentialService } from '../credentials/service.ts';
import { resolveOrgId } from './_session-cookie.ts';

type Deps = {
  db: PostgresJsDatabase;
  credentials: CredentialService;
};

const SmsBody = v.object({
  agentId: v.pipe(v.string(), v.uuid()),
  twilioAccountSid: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  twilioAuthToken: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  // E.164-ish: leading + then digits. Generous on length; Twilio enforces.
  phoneNumber: v.pipe(v.string(), v.regex(/^\+[1-9]\d{1,14}$/)),
});

export function channelsRoute({ db, credentials }: Deps) {
  const router = new Hono();

  router.post('/sms', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(SmsBody, json);
    if (!parsed.success) return c.json({ error: 'invalid_sms_channel_shape' }, 400);

    const { agentId, twilioAccountSid, twilioAuthToken, phoneNumber } = parsed.output;

    // The agent must belong to the operator's org.
    const [a] = await db
      .select()
      .from(agentTable)
      .where(and(eq(agentTable.id, agentId), eq(agentTable.orgId, orgId)))
      .limit(1);
    if (!a) return c.json({ error: 'agent_not_found' }, 404);

    // Prevent attaching the same Twilio number twice (the unique index on
    // (kind, address) would also catch this; checking up front gives a
    // friendlier error).
    const [existing] = await db
      .select({ id: channelTable.id })
      .from(channelTable)
      .where(and(eq(channelTable.kind, 'sms'), eq(channelTable.address, phoneNumber)))
      .limit(1);
    if (existing) return c.json({ error: 'phone_number_in_use' }, 409);

    await credentials.set(orgId, 'twilio', 'account_sid', twilioAccountSid);
    await credentials.set(orgId, 'twilio', 'auth_token', twilioAuthToken);

    const [created] = await db
      .insert(channelTable)
      .values({ orgId, kind: 'sms', agentId, address: phoneNumber })
      .returning();
    return c.json(
      {
        channel: {
          id: created!.id,
          kind: created!.kind,
          address: created!.address,
          agentId: created!.agentId,
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
