import { useCallback, useEffect, useState, type FormEvent } from 'react';

export type Agent = {
  id: string;
  name: string;
  persona: string;
  model: string;
  runtimeMode: 'headless' | 'dedicated';
  voiceEnabled: boolean;
  widgetChannelId: string | null;
  smsChannel: { id: string; phoneNumber: string } | null;
};

type FormDraft = {
  name: string;
  persona: string;
  model: string;
  voiceEnabled: boolean;
};

const EMPTY_DRAFT: FormDraft = {
  name: '',
  persona: '',
  model: 'gpt-4o-mini',
  voiceEnabled: false,
};

type DeleteTarget = { id: string; name: string };

type SmsDraft = {
  twilioAccountSid: string;
  twilioAuthToken: string;
  phoneNumber: string;
};

const EMPTY_SMS_DRAFT: SmsDraft = {
  twilioAccountSid: '',
  twilioAuthToken: '',
  phoneNumber: '',
};

export function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agents', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
      const body = (await res.json()) as { agents: Agent[] };
      setAgents(body.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function startCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setCreating(true);
  }

  function startEdit(a: Agent) {
    setCreating(false);
    setEditingId(a.id);
    setDraft({
      name: a.name,
      persona: a.persona,
      model: a.model,
      voiceEnabled: a.voiceEnabled,
    });
  }

  function cancelForm() {
    setCreating(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const url = editingId ? `/api/agents/${editingId}` : '/api/agents';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      await refresh();
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${pendingDelete.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed (${res.status})`);
      }
      await refresh();
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const formOpen = creating || editingId !== null;

  return (
    <section data-testid="agents-page" className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        {!formOpen && (
          <button
            type="button"
            onClick={startCreate}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
          >
            New agent
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {formOpen && (
        <form
          data-testid="agent-form"
          onSubmit={onSubmit}
          className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
        >
          <h2 className="text-lg font-semibold">
            {editingId ? 'Edit agent' : 'New agent'}
          </h2>
          <TextField
            label="Name"
            value={draft.name}
            onChange={(name) => setDraft((d) => ({ ...d, name }))}
            required
          />
          <TextAreaField
            label="Persona"
            value={draft.persona}
            onChange={(persona) => setDraft((d) => ({ ...d, persona }))}
            required
          />
          <TextField
            label="Model"
            value={draft.model}
            onChange={(model) => setDraft((d) => ({ ...d, model }))}
            required
          />
          <div className="text-sm text-zinc-400">
            Runtime mode: <span className="text-zinc-200">headless</span>
            <span className="ml-2 text-xs text-zinc-500">
              (dedicated mode lands in a later release)
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              data-testid="voice-enabled"
              checked={draft.voiceEnabled}
              onChange={(e) => setDraft((d) => ({ ...d, voiceEnabled: e.target.checked }))}
            />
            Voice enabled
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitLabel(submitting, editingId !== null)}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <AgentList
        loading={loading}
        agents={agents}
        onEdit={startEdit}
        onDelete={(a) => setPendingDelete({ id: a.id, name: a.name })}
        onSmsConnected={() => {
          void refresh();
        }}
      />

      {pendingDelete && (
        <div
          data-testid="delete-confirm"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-lg font-semibold">Delete agent?</h2>
            <p className="text-sm text-zinc-300">
              This permanently removes <span className="text-zinc-100">{pendingDelete.name}</span>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={submitting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {submitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AgentList({
  loading,
  agents,
  onEdit,
  onDelete,
  onSmsConnected,
}: {
  loading: boolean;
  agents: Agent[];
  onEdit: (a: Agent) => void;
  onDelete: (a: Agent) => void;
  onSmsConnected: () => void;
}) {
  const [openSmsAgentId, setOpenSmsAgentId] = useState<string | null>(null);
  if (loading) {
    return <p className="text-zinc-400 text-sm">Loading…</p>;
  }
  if (agents.length === 0) {
    return (
      <p data-testid="agents-empty" className="text-zinc-400 text-sm">
        No agents yet. Create one to get started.
      </p>
    );
  }
  return (
    <ul data-testid="agents-list" className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
      {agents.map((a) => (
        <li
          key={a.id}
          data-testid={`agent-row-${a.id}`}
          className="px-4 py-3 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-zinc-100">{a.name}</div>
              <div className="truncate text-xs text-zinc-400">
                {a.model} · voice {a.voiceEnabled ? 'on' : 'off'}
              </div>
              {a.widgetChannelId && (
                <div
                  data-testid={`agent-widget-channel-${a.id}`}
                  className="mt-1 truncate font-mono text-[10px] text-zinc-500"
                >
                  widget: {a.widgetChannelId}
                </div>
              )}
              {a.smsChannel && (
                <div
                  data-testid={`agent-sms-channel-${a.id}`}
                  className="mt-1 truncate text-xs text-zinc-300"
                >
                  SMS: <span className="font-mono">{a.smsChannel.phoneNumber}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {!a.smsChannel && (
                <button
                  type="button"
                  data-testid={`agent-connect-sms-${a.id}`}
                  onClick={() =>
                    setOpenSmsAgentId(openSmsAgentId === a.id ? null : a.id)
                  }
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  {openSmsAgentId === a.id ? 'Cancel' : 'Connect SMS'}
                </button>
              )}
              <button
                type="button"
                onClick={() => onEdit(a)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDelete(a)}
                className="rounded-md border border-red-700/60 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
              >
                Delete
              </button>
            </div>
          </div>

          {openSmsAgentId === a.id && (
            <SmsConnectForm
              agentId={a.id}
              onConnected={() => {
                setOpenSmsAgentId(null);
                onSmsConnected();
              }}
              onCancel={() => setOpenSmsAgentId(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function SmsConnectForm({
  agentId,
  onConnected,
  onCancel,
}: {
  agentId: string;
  onConnected: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SmsDraft>(EMPTY_SMS_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/channels/sms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ agentId, ...draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Connect failed (${res.status})`);
      }
      setDraft(EMPTY_SMS_DRAFT);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      data-testid={`sms-connect-form-${agentId}`}
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm"
    >
      <h3 className="font-semibold text-zinc-200">Connect an SMS number</h3>
      <p className="text-xs text-zinc-400">
        Paste the credentials from your Twilio console (Account → API keys & tokens).
        The Account SID and Auth Token live on the project's main dashboard;
        the phone number must already be provisioned in Twilio.
      </p>
      <TextField
        label="Twilio Account SID"
        value={draft.twilioAccountSid}
        onChange={(twilioAccountSid) => setDraft((d) => ({ ...d, twilioAccountSid }))}
        required
      />
      <TextField
        label="Twilio Auth Token"
        value={draft.twilioAuthToken}
        onChange={(twilioAuthToken) => setDraft((d) => ({ ...d, twilioAuthToken }))}
        required
      />
      <TextField
        label="Phone number (E.164, e.g. +15551234567)"
        value={draft.phoneNumber}
        onChange={(phoneNumber) => setDraft((d) => ({ ...d, phoneNumber }))}
        required
      />
      <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-400">
        <p className="font-medium text-zinc-300">After saving:</p>
        <p className="mt-1">
          In Twilio, open the phone number's settings and set the <em>"A Message
          Comes In"</em> webhook to{' '}
          <code className="rounded bg-zinc-800 px-1 font-mono">
            {`${typeof window === 'undefined' ? '' : window.location.origin}/sms/twilio/inbound`}
          </code>{' '}
          (HTTP POST). Twilio will sign each request with the auth token above; we
          verify it before dispatching to the agent.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save SMS channel'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function submitLabel(submitting: boolean, editing: boolean): string {
  if (submitting) return 'Saving…';
  if (editing) return 'Save changes';
  return 'Create agent';
}

function TextField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-zinc-300 mb-1">{label}</span>
      <input
        type="text"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-zinc-300 mb-1">{label}</span>
      <textarea
        value={value}
        required={required}
        rows={4}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
      />
    </label>
  );
}
