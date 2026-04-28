import { test, expect, beforeAll, afterAll } from 'bun:test';

const PROJECT = 'nexus-smoke';
const COMPOSE_FILE = 'docker-compose.yml';
const HEALTH_URL = `http://localhost:${process.env.NEXUS_PORT ?? '3000'}/healthz`;
const POLL_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

async function compose(args: string[], opts: { collect?: boolean } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['docker', 'compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (!opts.collect && exitCode !== 0) {
    console.error('docker compose failed:\n' + stdout + '\n' + stderr);
  }
  return { exitCode, stdout, stderr };
}

beforeAll(async () => {
  await compose(['down', '-v', '--remove-orphans'], { collect: true });
  const up = await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '180']);
  if (up.exitCode !== 0) {
    throw new Error(`docker compose up failed (exit ${up.exitCode})`);
  }
}, 10 * 60 * 1000);

afterAll(async () => {
  await compose(['logs', '--no-color'], { collect: true }).then(({ stdout }) => {
    if (process.env.NEXUS_SMOKE_PRINT_LOGS === '1') console.log(stdout);
  });
  await compose(['down', '-v', '--remove-orphans'], { collect: true });
}, 2 * 60 * 1000);

test(
  '/healthz reports postgres, minio, and embedding are reachable',
  async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastBody: unknown;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(HEALTH_URL);
        lastStatus = res.status;
        const body = (await res.json()) as {
          ok: boolean;
          postgres: { ok: boolean };
          minio: { ok: boolean };
          embedding: { ok: boolean };
        };
        lastBody = body;
        if (res.status === 200 && body.ok) {
          expect(body).toEqual({
            ok: true,
            postgres: { ok: true },
            minio: { ok: true },
            embedding: { ok: true },
          });
          return;
        }
      } catch {
        // server not up yet; keep polling
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    const logs = await compose(['logs', '--no-color', '--tail', '50'], { collect: true });
    throw new Error(
      `/healthz did not become ok within ${POLL_TIMEOUT_MS}ms\nlast status: ${lastStatus}\nlast body: ${JSON.stringify(lastBody)}\n--- compose logs ---\n${logs.stdout}`,
    );
  },
  POLL_TIMEOUT_MS + 30_000,
);
