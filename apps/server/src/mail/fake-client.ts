// In-memory MailtrapClient for tests. Mirrors the real client's contract:
//   - sendMail drops the message into the configured "send inbox".
//   - listMessages returns all messages in the named inbox.
//
// `injectInbound` lets a test simulate a customer (or an operator replying to
// an agent's email) sending mail into an inbox. This stands in for the real
// flow where mail arrives at a Mailtrap sandbox inbox from outside our system.
//
// Real Mailtrap sandbox: every email sent through the SMTP credentials lands
// in the inbox those credentials authenticate, regardless of `to`. The fake
// mirrors that — `sendMail` always appends to `sendInboxId`.

import type { MailtrapClient, MailtrapInboundMessage, SendMailArgs } from './client.ts';

export type FakeMailtrapClient = MailtrapClient & {
  injectInbound(inboxId: string, msg: Omit<MailtrapInboundMessage, 'id'>): MailtrapInboundMessage;
  inboxSnapshot(inboxId: string): MailtrapInboundMessage[];
};

export function createFakeMailtrapClient(opts: { sendInboxId: string }): FakeMailtrapClient {
  const inboxes = new Map<string, MailtrapInboundMessage[]>();
  let counter = 0;

  function append(inboxId: string, msg: MailtrapInboundMessage): void {
    const list = inboxes.get(inboxId);
    if (list) list.push(msg);
    else inboxes.set(inboxId, [msg]);
  }

  return {
    async listMessages(inboxId) {
      return [...(inboxes.get(inboxId) ?? [])];
    },

    async sendMail(args: SendMailArgs) {
      counter += 1;
      append(opts.sendInboxId, {
        id: `sent-${counter}`,
        from: args.from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        messageId: args.messageId,
        inReplyTo: args.inReplyTo,
        references: args.references,
      });
    },

    injectInbound(inboxId, msg) {
      counter += 1;
      const stored: MailtrapInboundMessage = { id: `inj-${counter}`, ...msg };
      append(inboxId, stored);
      return stored;
    },

    inboxSnapshot(inboxId) {
      return [...(inboxes.get(inboxId) ?? [])];
    },
  };
}
