// Per-session Bun Worker pool. Acceptance criterion: one Worker per active
// SDK session. A worker crash terminates only that session's Worker; the
// next dispatch for the session spawns a fresh one. The pool is the
// production wiring of `InvokeAgent`; tests inject a stub so they don't need
// to spawn workers.

import type { SdkOptions } from './sdk-options.ts';
import type { AgentTurn } from './runtime.ts';

type Pending = {
  resolve: (reply: string) => void;
  reject: (err: Error) => void;
};

type WorkerEntry = {
  worker: Worker;
  pending: Map<number, Pending>;
  nextId: number;
};

export type WorkerPool = {
  dispatch(sessionId: string, options: SdkOptions, history: AgentTurn[]): Promise<string>;
  shutdown(): Promise<void>;
};

type Deps = {
  workerPath: string;
  // Test seam: lets a test swap worker code between dispatches to simulate
  // a crashing worker followed by a fresh, healthy worker.
  spawn?: () => Worker;
};

export function createWorkerPool({ workerPath, spawn: spawnWorker }: Deps): WorkerPool {
  const workers = new Map<string, WorkerEntry>();
  const spawnFn = spawnWorker ?? (() => new Worker(workerPath));

  function spawn(sessionId: string): WorkerEntry {
    const worker = spawnFn();
    const entry: WorkerEntry = { worker, pending: new Map(), nextId: 1 };

    worker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as { id: number; ok: boolean; reply?: string; error?: string };
      const pending = entry.pending.get(msg.id);
      if (!pending) return;
      entry.pending.delete(msg.id);
      if (msg.ok && typeof msg.reply === 'string') {
        pending.resolve(msg.reply);
      } else {
        pending.reject(new Error(msg.error ?? 'worker returned unstructured failure'));
      }
    });

    // Bun terminates a Worker on uncaught error. Reject everything in flight
    // and drop the entry so the next dispatch spawns a fresh Worker.
    const handleFailure = (message: string) => {
      for (const p of entry.pending.values()) p.reject(new Error(message));
      entry.pending.clear();
      workers.delete(sessionId);
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
    };
    worker.addEventListener('error', (e: ErrorEvent) => {
      handleFailure(e.message || 'worker crashed');
    });
    worker.addEventListener('close', () => {
      if (entry.pending.size > 0) handleFailure('worker closed unexpectedly');
    });

    workers.set(sessionId, entry);
    return entry;
  }

  return {
    dispatch(sessionId, options, history) {
      const entry = workers.get(sessionId) ?? spawn(sessionId);
      const id = entry.nextId++;
      return new Promise<string>((resolve, reject) => {
        entry.pending.set(id, { resolve, reject });
        entry.worker.postMessage({ id, payload: { options, history } });
      });
    },
    async shutdown() {
      for (const entry of workers.values()) {
        for (const p of entry.pending.values()) {
          p.reject(new Error('worker pool shutting down'));
        }
        entry.pending.clear();
        try {
          entry.worker.terminate();
        } catch {
          /* ignore */
        }
      }
      workers.clear();
    },
  };
}
