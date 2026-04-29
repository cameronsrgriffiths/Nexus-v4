// Retry policy for write_knowledge.
//
// The headless agent retries up to MAX_WRITE_RETRIES (5) times on version
// conflict. On each conflict, the helper re-reads the current content,
// hands it to the caller's contentToWrite() callback to compute the next
// write payload (typical pattern: re-merge their addition on top of the
// fresh content), and tries again with the latest version.
//
// page_moved is followed transparently — the retry switches its target to
// the new coordinates and continues counting against the same retry budget.

import type {
  KnowledgeService,
  KnowledgeScope,
  WriteResult,
} from './service.ts';

export const MAX_WRITE_RETRIES = 5;

type ContentInput = {
  // The current content of the page when this attempt began. undefined if the
  // page does not yet exist (mode === 'create' on first call).
  current: string | undefined;
  attempt: number; // 1-based
};

export type RetryParams = {
  service: KnowledgeService;
  orgId: string;
  scope: KnowledgeScope;
  scopeId: string;
  title: string;
  mode: 'append' | 'overwrite' | 'create';
  // Compute the content to send. For append mode, this is what gets appended
  // (the service does the concatenation). For overwrite/create, this is the
  // full new content. Called fresh on every retry so the caller can re-derive
  // their addition against the latest current content.
  contentToWrite(input: ContentInput): string;
  // Optional hook fired between the read and the write of each attempt. Tests
  // use this to inject concurrent writes that race the in-flight write. The
  // hook runs *after* the helper has read the current version, *before* it
  // attempts the write — exactly the window where a real concurrent writer
  // would invalidate the version.
  onBeforeAttempt?(attempt: number): Promise<void>;
};

export type RetryResult =
  | { ok: true; id: string; version: number; scope: KnowledgeScope; scopeId: string; attempts: number }
  | { ok: false; reason: 'conflict_max_retries'; attempts: number }
  | { ok: false; reason: 'not_found'; attempts: number }
  | { ok: false; reason: 'already_exists'; id: string; attempts: number };

export async function writeKnowledgeWithRetry(params: RetryParams): Promise<RetryResult> {
  let scope = params.scope;
  let scopeId = params.scopeId;

  for (let attempt = 1; attempt <= MAX_WRITE_RETRIES; attempt++) {
    // Read current page state. lookup surfaces page_moved so we can follow
    // the redirect without doing a doomed write first.
    const looked = await params.service.lookup(params.orgId, {
      scope,
      scopeId,
      title: params.title,
    });

    if (looked.kind === 'moved') {
      scope = looked.newScope;
      scopeId = looked.newScopeId;
      continue;
    }

    const writeContent = params.contentToWrite({
      current: looked.kind === 'found' ? looked.content : undefined,
      attempt,
    });

    if (params.onBeforeAttempt) await params.onBeforeAttempt(attempt);

    let result: WriteResult;
    if (params.mode === 'create') {
      result = await params.service.write(params.orgId, {
        scope,
        scopeId,
        mode: 'create',
        title: params.title,
        content: writeContent,
      });
    } else if (looked.kind !== 'found') {
      // Caller asked for append/overwrite but the page doesn't exist (yet).
      // Surface immediately — retry won't help.
      return { ok: false, reason: 'not_found', attempts: attempt };
    } else {
      result = await params.service.write(params.orgId, {
        scope,
        scopeId,
        mode: params.mode,
        title: params.title,
        content: writeContent,
        version: looked.version,
      });
    }

    if (result.ok) {
      return {
        ok: true,
        id: result.id,
        version: result.version,
        scope,
        scopeId,
        attempts: attempt,
      };
    }

    if (result.reason === 'page_moved') {
      // Follow the redirect and retry against the new location. This counts
      // against the retry budget so a misconfigured chain of moves can't loop
      // forever.
      scope = result.newScope;
      scopeId = result.newScopeId;
      continue;
    }

    if (result.reason === 'already_exists') {
      return { ok: false, reason: 'already_exists', id: result.id, attempts: attempt };
    }

    if (result.reason === 'not_found') {
      return { ok: false, reason: 'not_found', attempts: attempt };
    }

    // conflict — loop and retry against the fresh content we'll re-read.
  }

  return { ok: false, reason: 'conflict_max_retries', attempts: MAX_WRITE_RETRIES };
}
