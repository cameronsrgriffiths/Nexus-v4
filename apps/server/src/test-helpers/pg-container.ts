// Tiny helper that boots a one-off Postgres container via `docker run` for tests.
// We don't use testcontainers-node because it occasionally hangs under Bun
// on macOS while validating the listening-ports wait strategy.

// pgvector/pgvector:pg16 — same image production uses (docker-compose.yml).
// We can't fall back to plain postgres here because migrations enable the
// `vector` extension at startup.
const IMAGE = 'pgvector/pgvector:pg16';

export type StartedPg = {
  url: string;
  stop: () => Promise<void>;
};

export async function startPg(): Promise<StartedPg> {
  const name = `nexus-test-${crypto.randomUUID()}`;
  const proc = Bun.spawn(
    [
      'docker',
      'run',
      '--rm',
      '-d',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD=test',
      '-e',
      'POSTGRES_USER=test',
      '-e',
      'POSTGRES_DB=test',
      '-P',
      IMAGE,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if (code !== 0) {
    throw new Error(`docker run failed (${code}): ${stderr}`);
  }
  const id = stdout.trim();

  const port = await waitForPort(id);
  await waitForReady(id);

  const url = `postgres://test:test@127.0.0.1:${port}/test`;
  await waitForConnect(url);
  return {
    url,
    stop: async () => {
      const s = Bun.spawn(['docker', 'rm', '-f', id], { stdout: 'pipe', stderr: 'pipe' });
      await s.exited;
    },
  };
}

async function waitForConnect(url: string): Promise<void> {
  // Even after pg_isready and TCP port are up, postgres may still report
  // "the database system is starting up" to incoming connections for a moment.
  // Poll with a real query until we get a clean answer.
  const { default: postgres } = await import('postgres');
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const sql = postgres(url, { max: 1, idle_timeout: 1, connect_timeout: 5 });
    try {
      await sql`SELECT 1`;
      await sql.end();
      return;
    } catch (err) {
      lastErr = err;
      try {
        await sql.end();
      } catch {
        /* ignore */
      }
      await sleep(250);
    }
  }
  throw new Error(
    `postgres never accepted a query: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function waitForPort(id: string): Promise<number> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const proc = Bun.spawn(['docker', 'port', id, '5432/tcp'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    if (code === 0) {
      const out = (await new Response(proc.stdout).text()).trim();
      // Lines like "0.0.0.0:55003" or "[::]:55003"; pick first IPv4 mapping.
      const line = out.split('\n').find((l) => l.includes('0.0.0.0:'));
      if (line) {
        const port = Number.parseInt(line.split(':').pop() ?? '', 10);
        if (Number.isFinite(port)) return port;
      }
    }
    await sleep(200);
  }
  throw new Error('postgres port mapping never appeared');
}

async function waitForReady(id: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const proc = Bun.spawn(
      ['docker', 'exec', id, 'pg_isready', '-U', 'test', '-d', 'test'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const code = await proc.exited;
    if (code === 0) return;
    await sleep(250);
  }
  throw new Error('postgres never became ready');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
