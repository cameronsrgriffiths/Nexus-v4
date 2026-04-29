// SMS channel routes:
//   - POST /twilio/inbound  — Twilio webhook for inbound SMS.
//   - POST /send            — operator-authenticated outbound proactive send.
//
// Inbound flow: verify Twilio's signature using the org's stored auth token,
// resolve the channel by `To`, dispatch the user turn through the same
// headless runtime the widget uses, then send the agent's reply back via
// the Twilio REST API. Returns an empty TwiML response so Twilio doesn't
// double-send.
//
// Outbound flow: looks up the contact's phone identifier and routes through
// the runtime's `resolveSession` (PRD invariant #10 — same code path as
// inbound, so reply continuity is automatic). Persists the assistant message
// via the runtime's outbound helper, then sends via Twilio.

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  channel as channelTable,
  contact as contactTable,
  identifier as identifierTable,
} from '../db/schema.ts';
import type { CredentialService } from '../credentials/service.ts';
import type { HeadlessRuntime } from '../headless/runtime.ts';
import { resolveOrgId } from '../routes/_session-cookie.ts';
import { sendTwilioSms, verifyTwilioSignature, type FetchLike } from './twilio.ts';

type Deps = {
  db: PostgresJsDatabase;
  credentials: CredentialService;
  runtime: HeadlessRuntime;
  twilioFetch?: FetchLike;
};

const SendBody = v.object({
  channelId: v.pipe(v.string(), v.uuid()),
  contactId: v.pipe(v.string(), v.uuid()),
  content: v.pipe(v.string(), v.minLength(1), v.maxLength(1600)),
});

export function smsRoute({ db, credentials, runtime, twilioFetch }: Deps) {
  const router = new Hono();

  router.post('/twilio/inbound', async (c) => {
    const raw = await c.req.raw.clone().text();
    const params = parseFormParams(raw);
    const to = params.To;
    const from = params.From;
    const body = params.Body;
    if (!to || !from || body === undefined) {
      return c.json({ error: 'invalid_twilio_payload' }, 400);
    }

    // Look up the SMS channel by the Twilio-side phone number. Channels are
    // unique on (kind, address) so there's at most one match.
    const [ch] = await db
      .select()
      .from(channelTable)
      .where(and(eq(channelTable.kind, 'sms'), eq(channelTable.address, to)))
      .limit(1);
    if (!ch) return c.json({ error: 'channel_not_found' }, 404);

    const authToken = await credentials.get(ch.orgId, 'twilio', 'auth_token');
    if (!authToken) return c.json({ error: 'twilio_credentials_missing' }, 500);
    const accountSid = await credentials.get(ch.orgId, 'twilio', 'account_sid');
    if (!accountSid) return c.json({ error: 'twilio_credentials_missing' }, 500);

    const url = inboundWebhookUrl(c.req.raw.url, c.req.header('x-forwarded-proto'));
    const signature = c.req.header('x-twilio-signature') ?? '';
    if (!verifyTwilioSignature(url, params, signature, authToken)) {
      return c.json({ error: 'invalid_signature' }, 403);
    }

    const result = await runtime.handleInbound({
      channelId: ch.id,
      identifierKind: 'phone',
      identifierValue: from,
      content: body,
    });

    await sendTwilioSms({
      accountSid,
      authToken,
      from: to,
      to: from,
      body: result.reply,
      fetch: twilioFetch,
    });

    // Empty TwiML — we already replied via the REST API.
    return c.body('<Response/>', 200, { 'content-type': 'text/xml' });
  });

  router.post('/send', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(SendBody, json);
    if (!parsed.success) return c.json({ error: 'invalid_send_shape' }, 400);
    const { channelId, contactId, content } = parsed.output;

    const [ch] = await db
      .select()
      .from(channelTable)
      .where(and(eq(channelTable.id, channelId), eq(channelTable.orgId, orgId)))
      .limit(1);
    if (!ch || ch.kind !== 'sms' || !ch.address) {
      return c.json({ error: 'channel_not_found' }, 404);
    }

    const [contactRow] = await db
      .select()
      .from(contactTable)
      .where(and(eq(contactTable.id, contactId), eq(contactTable.orgId, orgId)))
      .limit(1);
    if (!contactRow) return c.json({ error: 'contact_not_found' }, 404);
    if (contactRow.doNotContact) return c.json({ error: 'do_not_contact' }, 409);

    const [phone] = await db
      .select()
      .from(identifierTable)
      .where(and(eq(identifierTable.contactId, contactRow.id), eq(identifierTable.kind, 'phone')))
      .limit(1);
    if (!phone) return c.json({ error: 'contact_has_no_phone' }, 400);

    // Same resolveSession the inbound webhook uses — invariant #10. When the
    // contact replies, the inbound webhook will resolve to the same session.
    const out = await runtime.handleOutbound({
      channelId,
      identifierKind: 'phone',
      identifierValue: phone.value,
      content,
    });

    const authToken = await credentials.get(orgId, 'twilio', 'auth_token');
    const accountSid = await credentials.get(orgId, 'twilio', 'account_sid');
    if (!authToken || !accountSid) {
      return c.json({ error: 'twilio_credentials_missing' }, 500);
    }
    await sendTwilioSms({
      accountSid,
      authToken,
      from: ch.address,
      to: phone.value,
      body: content,
      fetch: twilioFetch,
    });

    return c.json({ sessionId: out.sessionId }, 200);
  });

  return router;
}

function parseFormParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(raw);
  for (const [k, v] of params) out[k] = v;
  return out;
}

function inboundWebhookUrl(reqUrl: string, forwardedProto: string | undefined): string {
  // Twilio signs the public URL it called. Behind a proxy the request URL the
  // server sees is `http://...`; honor `X-Forwarded-Proto` so signature
  // verification still works in production. Tests sign against the URL they
  // pass through `app.request`, so this is a no-op there.
  if (!forwardedProto) return reqUrl;
  const u = new URL(reqUrl);
  u.protocol = forwardedProto.includes('https') ? 'https:' : u.protocol;
  return u.toString();
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
