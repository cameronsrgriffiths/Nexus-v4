// Email channel: polls Mailtrap inboxes for new mail, hands each new message
// to the headless runtime as inbound, and sends the assistant's reply back
// out through SMTP. Threading (RFC 5322 In-Reply-To / References) connects
// inbound and outbound messages so an operator's reply lands in the same
// agent_session as our outbound (PRD invariant #10).
//
// Outbound initiation reuses runtime.resolveSession to honor invariant #10:
// the same code path that handles inbound creates/looks up the session for
// outbound-first conversations.

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { channel as channelTable, channelInboundSeen } from '../db/schema.ts';
import type { MailtrapClient } from './client.ts';
import { createSessionStore } from '../headless/session-store.ts';
import type { createHeadlessRuntime } from '../headless/runtime.ts';

export type EmailChannelDeps = {
  db: PostgresJsDatabase;
  client: MailtrapClient;
  runtime: ReturnType<typeof createHeadlessRuntime>;
};

export function createEmailChannel({ db, client, runtime }: EmailChannelDeps) {
  const store = createSessionStore({ db });

  // Run one poll cycle for one channel: fetch the inbox, dispatch any unseen
  // message through the runtime, and send the reply back through SMTP.
  async function pollChannel(channelId: string): Promise<void> {
    const [ch] = await db
      .select()
      .from(channelTable)
      .where(eq(channelTable.id, channelId))
      .limit(1);
    if (!ch || ch.kind !== 'email' || !ch.mailtrapInboxId || !ch.emailAddress) return;

    const messages = await client.listMessages(ch.mailtrapInboxId);
    for (const msg of messages) {
      // Skip our own outbound: the inbox holds both directions in the sandbox.
      if (msg.from === ch.emailAddress) continue;

      const inserted = await db
        .insert(channelInboundSeen)
        .values({ channelId: ch.id, externalId: msg.messageId })
        .onConflictDoNothing()
        .returning({ id: channelInboundSeen.id });
      if (inserted.length === 0) continue; // already processed

      // Reuse the same session resolver as the widget channel.
      const resolved = await runtime.resolveSession({
        channelId: ch.id,
        identifierKind: 'email',
        identifierValue: msg.from,
        content: msg.text,
      });

      // Persist the user turn carrying the inbound Message-ID so a later
      // reply (operator → us) can thread back into this session.
      await store.append(resolved.sessionId, {
        role: 'user',
        content: msg.text,
        externalId: msg.messageId,
      });

      // Invoke the agent over the session's full history (we just appended
      // the inbound user turn).
      const reply = await runtime.invokeOverHistory(resolved);

      // Outbound: same `to` as the inbound's `from`, threaded via headers.
      const outboundMessageId = generateMessageId(ch.emailAddress);
      const references = [...(msg.references ?? []), msg.messageId];
      await client.sendMail({
        from: ch.emailAddress,
        to: msg.from,
        subject: replySubject(msg.subject),
        text: reply,
        messageId: outboundMessageId,
        inReplyTo: msg.messageId,
        references,
      });

      await store.append(resolved.sessionId, {
        role: 'assistant',
        content: reply,
        externalId: outboundMessageId,
      });
    }
  }

  // Outbound-first send. The agent (or an operator on its behalf) initiates a
  // conversation by emailing a contact. Reuses runtime.resolveSession so the
  // session is the same one any subsequent inbound reply will land in.
  async function sendOutbound(args: {
    channelId: string;
    toEmail: string;
    content: string;
    subject?: string;
  }): Promise<{ sessionId: string; messageId: string }> {
    const [ch] = await db
      .select()
      .from(channelTable)
      .where(eq(channelTable.id, args.channelId))
      .limit(1);
    if (!ch || ch.kind !== 'email' || !ch.emailAddress) {
      throw new Error(`channel not an email channel: ${args.channelId}`);
    }

    const resolved = await runtime.resolveSession({
      channelId: ch.id,
      identifierKind: 'email',
      identifierValue: args.toEmail,
      content: args.content,
    });

    const messageId = generateMessageId(ch.emailAddress);
    await client.sendMail({
      from: ch.emailAddress,
      to: args.toEmail,
      subject: args.subject ?? 'Hello',
      text: args.content,
      messageId,
    });

    await store.append(resolved.sessionId, {
      role: 'assistant',
      content: args.content,
      externalId: messageId,
    });
    return { sessionId: resolved.sessionId, messageId };
  }

  return { pollChannel, sendOutbound };
}

function replySubject(original: string): string {
  if (/^re:/i.test(original)) return original;
  return `Re: ${original}`;
}

// RFC 5322 Message-ID with the channel's email domain so it looks plausible
// in a real client. The local part is randomized so two outbound sends never
// collide.
function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1] ?? 'nexus.local';
  return `<${crypto.randomUUID()}@${domain}>`;
}
