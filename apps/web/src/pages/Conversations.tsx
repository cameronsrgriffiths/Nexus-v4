// Operator-facing basic conversation view. Lists agent sessions for the org;
// clicking one shows its messages. The full timeline lands in #28.

import { useCallback, useEffect, useState } from 'react';

type ConversationSummary = {
  id: string;
  agentName: string;
  channelKind: string;
  createdAt: string;
};

type Message = {
  sequence: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

type ConversationDetail = ConversationSummary & {
  messages: Message[];
};

export function Conversations() {
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/conversations', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to load conversations (${res.status})`);
      const body = (await res.json()) as { conversations: ConversationSummary[] };
      setList(body.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations.');
    }
  }, []);

  const open = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
      const body = (await res.json()) as { conversation: ConversationDetail };
      setSelected(body.conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Auto-refresh so the new widget conversation shows up without a manual reload.
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <section data-testid="conversations-page" className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          Refresh
        </button>
      </header>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-4">
        <ul
          data-testid="conversations-list"
          className="col-span-1 divide-y divide-zinc-800 rounded-lg border border-zinc-800"
        >
          {(list ?? []).length === 0 && (
            <li
              data-testid="conversations-empty"
              className="px-4 py-3 text-sm text-zinc-400"
            >
              No conversations yet.
            </li>
          )}
          {(list ?? []).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void open(c.id)}
                data-testid={`conversation-row-${c.id}`}
                className="flex w-full items-start justify-between px-4 py-3 text-left hover:bg-zinc-800/40"
              >
                <span className="text-sm">
                  <span className="text-zinc-100">{c.agentName}</span>
                  <span className="ml-2 text-xs text-zinc-400">{c.channelKind}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div
          data-testid="conversation-detail"
          className="col-span-2 rounded-lg border border-zinc-800 p-4 space-y-2"
        >
          {!selected && (
            <p className="text-sm text-zinc-400">Select a conversation to view messages.</p>
          )}
          {selected?.messages.map((m) => (
            <div
              key={m.sequence}
              data-testid={`conversation-message-${m.role}`}
              className={
                m.role === 'user'
                  ? 'rounded-md bg-blue-900/40 px-3 py-2 text-sm text-zinc-100'
                  : 'rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-100'
              }
            >
              <span className="block text-xs text-zinc-400">{m.role}</span>
              {m.content}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
