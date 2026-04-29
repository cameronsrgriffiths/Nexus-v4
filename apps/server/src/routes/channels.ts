// Operator channels API.
//
// `POST /api/channels/sms` connects a Twilio phone number to an agent:
//   - persists `twilio.account_sid` + `twilio.auth_token` in the per-org
//     credential store (slice #4),
//   - inserts an SMS `channel` row keyed on the phone number for inbound
//     resolution.
//
// `POST /api/channels/telegram` connects a Telegram bot to an agent:
//   - persists `telegram.bot_token` in the per-org credential store,
//   - inserts a Telegram `channel` row keyed on the bot id (the integer
//     prefix of the token) for inbound resolution.
//
// The operator UI uses these endpoints to wire up SMS / Telegram. The webhook
// URL the operator pastes into the provider's console points at the public
// inbound route (`/sms/twilio/inbound`, `/telegram/webhook/<botId>`).

import { Hono } from 'hono';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agent as agentTable, channel as channelTable } from '../db/schema.ts';
import type { CredentialService } from '../credentials/service.ts';
import { resolveOrgId } from './_session-cookie.ts';
import { botIdFromToken } from '../telegram/telegram.ts';

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

const TelegramBody = v.object({
  agentId: v.pipe(v.string(), v.uuid()),
  // Telegram bot tokens look like `<digits>:<auth>`. We re-validate the bot id
  // can be parsed below; this regex blocks the obviously malformed ones up
  // front.
  botToken: v.pipe(v.string(), v.regex(/^\d+:[A-Za-z0-9_-]+$/), v.maxLength(256)),
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

  router.post('/telegram', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(TelegramBody, json);
    if (!parsed.success) return c.json({ error: 'invalid_telegram_channel_shape' }, 400);

    const { agentId, botToken } = parsed.output;
    const botId = botIdFromToken(botToken);
    if (!botId) return c.json({ error: 'invalid_telegram_channel_shape' }, 400);

    const [a] = await db
      .select()
      .from(agentTable)
      .where(and(eq(agentTable.id, agentId), eq(agentTable.orgId, orgId)))
      .limit(1);
    if (!a) return c.json({ error: 'agent_not_found' }, 404);

    // Bot id is unique across Telegram, and we key the channel on it so the
    // public webhook can resolve without touching the secret token. The
    // (kind, address) unique index also enforces this at the DB level.
    const [existing] = await db
      .select({ id: channelTable.id })
      .from(channelTable)
      .where(and(eq(channelTable.kind, 'telegram'), eq(channelTable.address, botId)))
      .limit(1);
    if (existing) return c.json({ error: 'telegram_bot_in_use' }, 409);

    await credentials.set(orgId, 'telegram', 'bot_token', botToken);

    const [created] = await db
      .insert(channelTable)
      .values({ orgId, kind: 'telegram', agentId, address: botId })
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
