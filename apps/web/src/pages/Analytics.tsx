// Operator analytics page. Three charts: messages over time, per channel,
// per agent. Renders SVG bar charts inline so this slice doesn't pull in a
// chart library; the data shape it consumes matches GET /api/analytics.

import { useCallback, useEffect, useState } from 'react';

type OverTimePoint = { day: string; count: number };
type PerChannelRow = { channelKind: string; count: number };
type PerAgentRow = { agentId: string; agentName: string; count: number };

type AnalyticsBody = {
  overTime: OverTimePoint[];
  perChannel: PerChannelRow[];
  perAgent: PerAgentRow[];
};

export function Analytics() {
  const [data, setData] = useState<AnalyticsBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/analytics', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to load analytics (${res.status})`);
      setData((await res.json()) as AnalyticsBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section data-testid="analytics-page" className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
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

      <ChartCard testId="analytics-over-time" title="Messages over time">
        <BarChart
          rowTestIdPrefix="analytics-over-time-row"
          rows={(data?.overTime ?? []).map((p) => ({
            label: p.day,
            count: p.count,
          }))}
          emptyTestId="analytics-over-time-empty"
        />
      </ChartCard>

      <ChartCard testId="analytics-per-channel" title="Messages per channel">
        <BarChart
          rowTestIdPrefix="analytics-per-channel-row"
          rows={(data?.perChannel ?? []).map((r) => ({
            label: r.channelKind,
            count: r.count,
          }))}
          emptyTestId="analytics-per-channel-empty"
        />
      </ChartCard>

      <ChartCard testId="analytics-per-agent" title="Messages per agent">
        <BarChart
          rowTestIdPrefix="analytics-per-agent-row"
          rows={(data?.perAgent ?? []).map((r) => ({
            label: r.agentName,
            count: r.count,
          }))}
          emptyTestId="analytics-per-agent-empty"
        />
      </ChartCard>
    </section>
  );
}

function ChartCard({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3"
    >
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      {children}
    </div>
  );
}

type BarRow = { label: string; count: number };

function BarChart({
  rows,
  rowTestIdPrefix,
  emptyTestId,
}: {
  rows: BarRow[];
  rowTestIdPrefix: string;
  emptyTestId: string;
}) {
  if (rows.length === 0) {
    return (
      <p data-testid={emptyTestId} className="text-sm text-zinc-400">
        No data yet.
      </p>
    );
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const pct = (row.count / max) * 100;
        const rowTestId = `${rowTestIdPrefix}-${row.label}`;
        return (
          <li
            key={row.label}
            data-testid={rowTestId}
            className="flex items-center gap-3"
          >
            <span className="w-32 shrink-0 truncate text-sm text-zinc-300">{row.label}</span>
            <span className="relative h-4 flex-1 rounded bg-zinc-800">
              <span
                className="absolute inset-y-0 left-0 rounded bg-emerald-500/70"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span
              data-testid={`${rowTestId}-count`}
              className="w-10 shrink-0 text-right text-sm tabular-nums text-zinc-200"
            >
              {row.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
