// Bun Worker entrypoint — one Worker = one SDK session (PRD invariant on
// crash isolation in this slice).
//
// Receives `{ id, payload: { options, history } }`, calls the Claude Agent
// SDK, replies with `{ id, ok, reply }` or `{ id, ok: false, error }`.
//
// In production this would import the real Claude Agent SDK. The package
// isn't available in CI yet, so we shell out to a deterministic echo to
// keep the inbound code path runnable end-to-end. The hand-off shape is
// stable: dropping in the real SDK only changes the function call below.

/// <reference lib="webworker" />
import type { SdkOptions } from './sdk-options.ts';

declare const self: DedicatedWorkerGlobalScope;

type IncomingMessage = {
  id: number;
  payload: {
    options: SdkOptions;
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  };
};

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as IncomingMessage;
  try {
    const reply = await runAgent(msg.payload.options, msg.payload.history);
    self.postMessage({ id: msg.id, ok: true, reply });
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

async function runAgent(
  _options: SdkOptions,
  history: IncomingMessage['payload']['history'],
): Promise<string> {
  // Placeholder until the Claude Agent SDK is wired in this monorepo.
  // The deterministic echo lets us prove the end-to-end widget→runtime→worker
  // path without an outbound API call. Replace with the SDK call site:
  //
  //   import { query } from '@anthropic-ai/claude-agent-sdk';
  //   const stream = query({ prompt: ..., options: _options });
  //   ...accumulate text turns...
  //
  const last = history[history.length - 1];
  return `Echo: ${last?.content ?? ''}`;
}
