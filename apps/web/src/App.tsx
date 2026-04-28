import { useEffect, useState } from 'react';

type HealthCheck = { ok: boolean; error?: string };
type HealthResponse = {
  ok: boolean;
  postgres: HealthCheck;
  minio: HealthCheck;
  embedding: HealthCheck;
};

type Status = { state: 'loading' } | { state: 'ok'; data: HealthResponse } | { state: 'error'; error: string };

export function App() {
  const [status, setStatus] = useState<Status>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/healthz')
      .then(async (res) => {
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setStatus({ state: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">Nexus</h1>
        <p className="text-zinc-400 text-sm">Self-hosted agents platform · slice 1 placeholder</p>
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
          <h2 className="text-sm uppercase tracking-wide text-zinc-500">Health</h2>
          {status.state === 'loading' && <p className="text-zinc-400">Checking…</p>}
          {status.state === 'error' && <p className="text-red-400">Failed: {status.error}</p>}
          {status.state === 'ok' && <HealthList data={status.data} />}
        </section>
      </div>
    </main>
  );
}

function HealthList({ data }: { data: HealthResponse }) {
  const rows: Array<[string, HealthCheck]> = [
    ['Postgres', data.postgres],
    ['MinIO', data.minio],
    ['Embedding', data.embedding],
  ];
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map(([name, check]) => (
        <li key={name} className="flex items-center justify-between gap-3">
          <span>{name}</span>
          <span className={check.ok ? 'text-emerald-400' : 'text-red-400'}>
            {check.ok ? 'ok' : (check.error ?? 'down')}
          </span>
        </li>
      ))}
    </ul>
  );
}
