// Telegram channel routes:
//   - POST /telegram/webhook/:botId — Telegram bot webhook for inbound updates.
//   - POST /telegram/send             — operator-authenticated outbound send.
//
// Inbound: Telegram POSTs an Update; we resolve the channel by bot id (from
// the URL), look up the org's stored bot token, dispatch the user turn through
// the same headless runtime the widget uses, then send the agent's reply
// back through the Telegram bot API. 1-on-1 only at v1.0 — non-private chats
// are dropped.
//
// Outbound: looks up the contact's `telegram_user_id` identifier and routes
// through the runtime's outbound helper (PRD invariant #10 — same code path
// as inbound, so reply continuity is automatic).

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
import { sendTelegramMessage, type FetchLike } from './telegram.ts';

type Deps = {
  db: PostgresJsDatabase;
  credentials: CredentialService;
  runtime: HeadlessRuntime;
  telegramFetch?: FetchLike;
};

const SendBody = v.object({
  channelId: v.pipe(v.string(), v.uuid()),
  contactId: v.pipe(v.string(), v.uuid()),
  content: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
});

export function telegramRoute({ db, credentials, runtime, telegramFetch }: Deps) {
  const router = new Hono();

  router.post('/webhook/:botId', async (c) => {
    const botId = c.req.param('botId');
    const update = (await safeJson(c.req.raw)) as TelegramUpdate | null;
    const message = update?.message;
    const from = message?.from;
    if (!message || !from || from.is_bot) {
      // Edits, callbacks, bot-to-bot relays, anonymous-channel posts — out of
      // scope for the 1-on-1 text path. Acknowledge so Telegram stops retrying.
      return c.json({ ok: true }, 200);
    }
    if (message.chat.type !== 'private') {
      // Group chats deferred to v1.1+.
      return c.json({ ok: true }, 200);
    }
    if (typeof message.text !== 'string' || message.text.length === 0) {
      return c.json({ ok: true }, 200);
    }

    const [ch] = await db
      .select()
      .from(channelTable)
      .where(and(eq(channelTable.kind, 'telegram'), eq(channelTable.address, botId)))
      .limit(1);
    if (!ch) return c.json({ error: 'channel_not_found' }, 404);

    const botToken = await credentials.get(ch.orgId, 'telegram', 'bot_token');
    if (!botToken) return c.json({ error: 'telegram_bot_token_missing' }, 500);

    const result = await runtime.handleInbound({
      channelId: ch.id,
      identifierKind: 'telegram_user_id',
      identifierValue: String(from.id),
      content: message.text,
    });

    await sendTelegramMessage({
      botToken,
      chatId: message.chat.id,
      text: result.reply,
      fetch: telegramFetch,
    });

    return c.json({ ok: true }, 200);
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
    if (!ch || ch.kind !== 'telegram') {
      return c.json({ error: 'channel_not_found' }, 404);
    }

    const [contactRow] = await db
      .select()
      .from(contactTable)
      .where(and(eq(contactTable.id, contactId), eq(contactTable.orgId, orgId)))
      .limit(1);
    if (!contactRow) return c.json({ error: 'contact_not_found' }, 404);
    if (contactRow.doNotContact) return c.json({ error: 'do_not_contact' }, 409);

    const [tg] = await db
      .select()
      .from(identifierTable)
      .where(
        and(
          eq(identifierTable.contactId, contactRow.id),
          eq(identifierTable.kind, 'telegram_user_id'),
        ),
      )
      .limit(1);
    if (!tg) return c.json({ error: 'contact_has_no_telegram_id' }, 400);

    // Same resolveSession the inbound webhook uses — invariant #10. When the
    // contact replies, the inbound webhook will resolve to the same session.
    const out = await runtime.handleOutbound({
      channelId,
      identifierKind: 'telegram_user_id',
      identifierValue: tg.value,
      content,
    });

    const botToken = await credentials.get(orgId, 'telegram', 'bot_token');
    if (!botToken) return c.json({ error: 'telegram_bot_token_missing' }, 500);
    const chatId = Number.parseInt(tg.value, 10);
    if (!Number.isFinite(chatId)) return c.json({ error: 'invalid_chat_id' }, 500);
    await sendTelegramMessage({
      botToken,
      chatId,
      text: content,
      fetch: telegramFetch,
    });

    return c.json({ sessionId: out.sessionId }, 200);
  });

  return router;
}

// Subset of Telegram's Update shape we read. Other fields (entities, photos,
// location, edited_message, callback_query, etc.) ride along on the JSON but
// don't affect the 1-on-1 text path; we ignore them.
type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean };
    chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
    text?: string;
  };
};

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
