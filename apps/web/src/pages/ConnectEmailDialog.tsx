// Operator-facing connect-email dialog.
//
// Captures the org's Mailtrap credentials and the per-channel inbox + send
// address, then POSTs /api/email/channels which stores creds via the
// credential service (#4) and creates the channel row.
//
// Inline explanation up front: this is the first time most operators will
// have seen Mailtrap referenced in the platform; the copy makes it clear what
// the four fields are for and where to find them in their Mailtrap account.

import { useState, type FormEvent } from 'react';
import type { Agent } from './Agents';

type Draft = {
  emailAddress: string;
  mailtrapInboxId: string;
  mailtrapAccountId: string;
  mailtrapApiToken: string;
  mailtrapSmtpUser: string;
  mailtrapSmtpPass: string;
};

const EMPTY: Draft = {
  emailAddress: '',
  mailtrapInboxId: '',
  mailtrapAccountId: '',
  mailtrapApiToken: '',
  mailtrapSmtpUser: '',
  mailtrapSmtpPass: '',
};

export function ConnectEmailDialog({
  agent,
  onClose,
  onConnected,
}: {
  agent: Agent;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/email/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ agentId: agent.id, ...draft }),
      });
      if (!res.ok) throw new Error(`Failed to connect (${res.status})`);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="connect-email-dialog"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5"
      >
        <header>
          <h2 className="text-lg font-semibold">Connect email — {agent.name}</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Wire up an email channel for this agent through Mailtrap. We use
            Mailtrap's sandbox SMTP to send replies and its inbox API to pick
            up incoming mail. You'll find the four credential fields below in
            the <span className="text-zinc-200">Integration</span> tab of your
            Mailtrap sandbox inbox.
          </p>
        </header>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <Field
          label="Reply-from address"
          hint="Address the agent's outbound emails will come from."
          value={draft.emailAddress}
          onChange={(emailAddress) => setDraft((d) => ({ ...d, emailAddress }))}
          type="email"
          testid="email-address"
        />
        <Field
          label="Mailtrap inbox ID"
          hint="From the URL of your sandbox inbox: .../inboxes/{inbox_id}."
          value={draft.mailtrapInboxId}
          onChange={(mailtrapInboxId) => setDraft((d) => ({ ...d, mailtrapInboxId }))}
          testid="mailtrap-inbox-id"
        />
        <Field
          label="Mailtrap account ID"
          hint="From the same URL: .../accounts/{account_id}/..."
          value={draft.mailtrapAccountId}
          onChange={(mailtrapAccountId) => setDraft((d) => ({ ...d, mailtrapAccountId }))}
          testid="mailtrap-account-id"
        />
        <Field
          label="Mailtrap API token"
          hint="Found under My Profile → API Tokens."
          value={draft.mailtrapApiToken}
          onChange={(mailtrapApiToken) => setDraft((d) => ({ ...d, mailtrapApiToken }))}
          type="password"
          testid="mailtrap-api-token"
        />
        <Field
          label="SMTP username"
          hint="Shown under the Integration tab of your sandbox inbox."
          value={draft.mailtrapSmtpUser}
          onChange={(mailtrapSmtpUser) => setDraft((d) => ({ ...d, mailtrapSmtpUser }))}
          testid="mailtrap-smtp-user"
        />
        <Field
          label="SMTP password"
          hint="Shown next to the SMTP username."
          value={draft.mailtrapSmtpPass}
          onChange={(mailtrapSmtpPass) => setDraft((d) => ({ ...d, mailtrapSmtpPass }))}
          type="password"
          testid="mailtrap-smtp-pass"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {submitting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  type,
  testid,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  type?: string;
  testid?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-zinc-300 mb-1">{label}</span>
      <input
        type={type ?? 'text'}
        value={value}
        required
        data-testid={testid}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
      />
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
