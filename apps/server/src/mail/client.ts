// Mailtrap client: thin wrapper over the two operations the email channel
// needs from Mailtrap.
//
//   1. List/fetch messages from a sandbox inbox (HTTP API).
//   2. Send mail through Mailtrap's SMTP.
//
// The interface is small on purpose — the rest of the email-channel code
// depends on this shape, not on nodemailer or fetch directly. An in-memory
// implementation lives next to it for integration tests.

import nodemailer from 'nodemailer';

export type MailtrapInboundMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  // RFC 5322 Message-ID of the message we received. Used as the agent_message
  // external_id and as the In-Reply-To value when we reply.
  messageId: string;
  // The Message-ID this message was a reply to, if any. Used to thread
  // operator replies into the same agent session as our outbound (PRD #10).
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
};

export type SendMailArgs = {
  from: string;
  to: string;
  subject: string;
  text: string;
  // The Message-ID we set on the outgoing email. Caller controls this so the
  // agent_message row and the wire-level header match exactly.
  messageId: string;
  inReplyTo?: string | undefined;
  references?: string[] | undefined;
};

export type MailtrapClient = {
  listMessages(inboxId: string): Promise<MailtrapInboundMessage[]>;
  sendMail(args: SendMailArgs): Promise<void>;
};

export type MailtrapHttpConfig = {
  apiToken: string;
  accountId: string;
  // sandbox.api.mailtrap.io for the testing/sandbox API. Configurable so tests
  // can point at a local fake.
  apiBase?: string;
};

export type MailtrapSmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

// Real Mailtrap implementation. List uses the sandbox HTTP API; send uses
// nodemailer over SMTP.
export function createMailtrapClient(config: {
  http: MailtrapHttpConfig;
  smtp: MailtrapSmtpConfig;
}): MailtrapClient {
  const apiBase = config.http.apiBase ?? 'https://sandbox.api.mailtrap.io';
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });

  return {
    async listMessages(inboxId) {
      const url = `${apiBase}/api/accounts/${config.http.accountId}/inboxes/${inboxId}/messages`;
      const res = await fetch(url, {
        headers: {
          'Api-Token': config.http.apiToken,
          accept: 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`mailtrap list ${res.status}: ${await res.text()}`);
      }
      const rows = (await res.json()) as Array<{
        id: number;
        from_email: string;
        to_email: string;
        subject: string;
        text_body?: string;
        message_id?: string;
        in_reply_to?: string;
        references?: string[];
      }>;
      // Sandbox API returns rows without bodies; fetch the full body per row.
      const messages: MailtrapInboundMessage[] = [];
      for (const row of rows) {
        const bodyUrl = `${apiBase}/api/accounts/${config.http.accountId}/inboxes/${inboxId}/messages/${row.id}/body.txt`;
        const bodyRes = await fetch(bodyUrl, {
          headers: { 'Api-Token': config.http.apiToken },
        });
        const text = bodyRes.ok ? await bodyRes.text() : (row.text_body ?? '');
        messages.push({
          id: String(row.id),
          from: row.from_email,
          to: row.to_email,
          subject: row.subject,
          text,
          messageId: row.message_id ?? `mailtrap-${row.id}`,
          inReplyTo: row.in_reply_to,
          references: row.references,
        });
      }
      return messages;
    },

    async sendMail(args) {
      const headers: Record<string, string> = {};
      if (args.inReplyTo) headers['In-Reply-To'] = args.inReplyTo;
      if (args.references && args.references.length > 0) {
        headers['References'] = args.references.join(' ');
      }
      await transporter.sendMail({
        from: args.from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        messageId: args.messageId,
        headers,
      });
    },
  };
}
