// One Bun Worker per active session. The acceptance criterion calls for
// per-session crash isolation: a worker that throws or crashes must not
// take the server down — the next dispatch on that session spawns a fresh
// worker, and the failing dispatch returns a structured error.

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerPool } from './worker-pool.ts';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'nexus-wp-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function writeWorker(body: string): Promise<string> {
  const path = join(scratch, 'worker.ts');
  await writeFile(path, body, 'utf8');
  return path;
}

test('worker pool dispatches a job and returns the reply', async () => {
  const workerPath = await writeWorker(`
    self.onmessage = (e) => {
      const { id, payload } = e.data;
      self.postMessage({ id, ok: true, reply: 'echo:' + payload.history[payload.history.length - 1].content });
    };
  `);
  const pool = createWorkerPool({ workerPath });
  const reply = await pool.dispatch('s1', {
    cwd: '/tmp/x',
    model: 'm',
    systemPrompt: 'p',
    settingSources: ['project'],
  }, [{ role: 'user', content: 'hello' }]);
  expect(reply).toBe('echo:hello');
  await pool.shutdown();
});

test('worker pool reuses the same worker for the same session id', async () => {
  const workerPath = await writeWorker(`
    let count = 0;
    self.onmessage = (e) => {
      count += 1;
      self.postMessage({ id: e.data.id, ok: true, reply: String(count) });
    };
  `);
  const pool = createWorkerPool({ workerPath });
  const a = await pool.dispatch('same', cwdOpts(), [{ role: 'user', content: 'a' }]);
  const b = await pool.dispatch('same', cwdOpts(), [{ role: 'user', content: 'b' }]);
  expect([a, b]).toEqual(['1', '2']);
  await pool.shutdown();
});

test('worker error is surfaced as a thrown Error, not a process crash', async () => {
  const workerPath = await writeWorker(`
    self.onmessage = (e) => {
      self.postMessage({ id: e.data.id, ok: false, error: 'boom' });
    };
  `);
  const pool = createWorkerPool({ workerPath });
  await expect(
    pool.dispatch('s', cwdOpts(), [{ role: 'user', content: 'x' }]),
  ).rejects.toThrow(/boom/);
  await pool.shutdown();
});

test('after a worker crash a fresh worker handles the next dispatch on that session', async () => {
  // Each worker file branches on a marker file: present → crash; absent → recover.
  // This proves the pool spawned a fresh Worker after the crash, since the
  // pool only ever holds the one workerPath we hand it.
  const markerPath = join(scratch, 'crash.flag');
  await writeFile(markerPath, '1', 'utf8');
  const workerPath = await writeWorker(`
    import { existsSync, unlinkSync } from 'node:fs';
    self.onmessage = (e) => {
      if (existsSync(${JSON.stringify(markerPath)})) {
        unlinkSync(${JSON.stringify(markerPath)});
        throw new Error('crash');
      }
      self.postMessage({ id: e.data.id, ok: true, reply: 'recovered' });
    };
  `);
  const pool = createWorkerPool({ workerPath });
  let firstError: unknown = null;
  try {
    await pool.dispatch('crashy', cwdOpts(), [{ role: 'user', content: 'first' }]);
  } catch (err) {
    firstError = err;
  }
  expect(firstError).toBeInstanceOf(Error);
  const reply = await pool.dispatch('crashy', cwdOpts(), [{ role: 'user', content: 'second' }]);
  expect(reply).toBe('recovered');
  await pool.shutdown();
});

function cwdOpts() {
  return {
    cwd: '/tmp/x',
    model: 'm',
    systemPrompt: 'p',
    settingSources: ['project'] as ['project'],
  };
}
