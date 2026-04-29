// Operator-facing knowledge page editor. Loads a single page by
// (scope, scopeId, title) from query params, lets the operator edit, and
// submits the save with the version it loaded.
//
// On a 409 conflict from the server, the page surfaces the two-button
// dialog: "Restart my edit" reloads the current content + version (operator's
// draft is discarded), "Force my version" calls /page/force which records the
// agent's lost write in the audit log.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

type LoadedPage = {
  id: string;
  title: string;
  content: string;
  version: number;
};

type ConflictState = {
  currentContent: string;
  currentVersion: number;
};

type SaveMode = 'append' | 'overwrite';

function useQueryParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export function Knowledge() {
  const params = useQueryParams();
  const scope = params.get('scope') ?? '';
  const scopeId = params.get('scopeId') ?? '';
  const title = params.get('title') ?? '';

  const [page, setPage] = useState<LoadedPage | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [mode, setMode] = useState<SaveMode>('overwrite');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!scope || !scopeId || !title) {
      setError('Missing scope, scopeId, or title query params.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setConflict(null);
    setStatusMessage(null);
    try {
      const url = `/api/knowledge/page?scope=${encodeURIComponent(
        scope,
      )}&scopeId=${encodeURIComponent(scopeId)}&title=${encodeURIComponent(title)}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.status === 404) {
        setError('Page not found.');
        setPage(null);
        setDraft('');
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load page (${res.status})`);
      }
      const body = (await res.json()) as { page: LoadedPage };
      setPage(body.page);
      setDraft(body.page.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load page.');
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId, title]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!page) return;
    setSubmitting(true);
    setError(null);
    setStatusMessage(null);
    try {
      // For append mode, the server appends the *delta* on top of current —
      // it does the concatenation. Send the part the operator added (the
      // suffix beyond loaded content). For overwrite mode, send the full
      // draft.
      const contentToSend =
        mode === 'append' ? extractAppendDelta(page.content, draft) : draft;
      if (mode === 'append' && contentToSend.length === 0) {
        setError('Append mode needs new text added at the end of the existing content.');
        return;
      }
      const res = await fetch('/api/knowledge/page', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          scope,
          scopeId,
          title,
          mode,
          content: contentToSend,
          version: page.version,
        }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as ConflictState;
        setConflict({
          currentContent: body.currentContent,
          currentVersion: body.currentVersion,
        });
        return;
      }
      if (!res.ok) {
        throw new Error(`Save failed (${res.status})`);
      }
      const body = (await res.json()) as {
        ok: boolean;
        version: number;
        autoMerged: boolean;
      };
      // Reload to pick up the merged content + bumped version.
      await reload();
      setStatusMessage(
        body.autoMerged ? 'Saved (auto-merged with concurrent changes).' : 'Saved.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onForce() {
    if (!page) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/knowledge/page/force', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          scope,
          scopeId,
          title,
          // Force always sends the full draft; appends-on-conflict aren't
          // forceable because they don't have a "current full content" the
          // operator can vouch for.
          content: draft,
        }),
      });
      if (!res.ok) {
        throw new Error(`Force failed (${res.status})`);
      }
      setConflict(null);
      await reload();
      setStatusMessage('Forced your version — the agent\'s intervening write was logged.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Force failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onRestart() {
    setConflict(null);
    await reload();
    setStatusMessage('Reloaded — your draft was discarded.');
  }

  return (
    <section data-testid="knowledge-page" className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
        <p className="text-xs text-zinc-400">
          {scope ? (
            <>
              Editing <span className="text-zinc-200">{title || '(no title)'}</span> in scope{' '}
              <span className="text-zinc-200">{scope}</span> /{' '}
              <span className="font-mono text-zinc-300">{scopeId || '(no id)'}</span>
            </>
          ) : (
            'Provide ?scope=&scopeId=&title= in the URL to edit a page.'
          )}
        </p>
      </header>

      {error && (
        <p data-testid="knowledge-error" role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {statusMessage && (
        <p data-testid="knowledge-status" className="text-sm text-emerald-400">
          {statusMessage}
        </p>
      )}

      {loading ? (
        <p className="text-zinc-400 text-sm">Loading…</p>
      ) : page ? (
        <form
          data-testid="knowledge-form"
          onSubmit={onSubmit}
          className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
        >
          <div className="text-xs text-zinc-400">
            Loaded version{' '}
            <span data-testid="knowledge-version" className="font-mono text-zinc-200">
              {page.version}
            </span>
          </div>
          <label className="block text-sm">
            <span className="block text-zinc-300 mb-1">Mode</span>
            <select
              data-testid="knowledge-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as SaveMode)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
            >
              <option value="overwrite">Overwrite</option>
              <option value="append">Append</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="block text-zinc-300 mb-1">Content</span>
            <textarea
              data-testid="knowledge-content"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              data-testid="knowledge-save"
              disabled={submitting}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : null}

      {conflict && (
        <div
          data-testid="knowledge-conflict-dialog"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-lg font-semibold">Conflict</h2>
            <p className="text-sm text-zinc-300">
              The agent (or another operator) changed this page after you started editing.
              Decide what to do with your draft.
            </p>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-xs">
              <div className="text-zinc-400">
                Current version{' '}
                <span className="font-mono text-zinc-200">{conflict.currentVersion}</span>
              </div>
              <pre
                data-testid="knowledge-conflict-current"
                className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-zinc-200"
              >
                {conflict.currentContent}
              </pre>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="knowledge-restart"
                onClick={() => void onRestart()}
                disabled={submitting}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
              >
                Restart my edit
              </button>
              <button
                type="button"
                data-testid="knowledge-force"
                onClick={() => void onForce()}
                disabled={submitting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                Force my version
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// For append mode the server appends `\n${delta}` to current content. The
// editor's draft holds the full text; figure out the suffix the operator
// added beyond the loaded content. If the operator changed the prefix (which
// makes append wrong anyway), this returns the empty string and the form
// rejects the submission.
function extractAppendDelta(loadedContent: string, draft: string): string {
  const expectedPrefix = loadedContent + '\n';
  if (draft === loadedContent) return '';
  if (draft.startsWith(expectedPrefix)) return draft.slice(expectedPrefix.length);
  if (draft.startsWith(loadedContent)) return draft.slice(loadedContent.length);
  return '';
}
