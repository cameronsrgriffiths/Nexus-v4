// Minimal end-to-end server that backs the Playwright test:
//   - Boots a Postgres container.
//   - Runs Drizzle migrations.
//   - Serves the auth API and the built Vite dist on a single port.
//
// Started by playwright.config.ts via the webServer option, killed when the
// run finishes.

import { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg } from './pg-container.ts';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { authRoute } from '../routes/auth.ts';
import { agentsRoute } from '../routes/agents.ts';
import { widgetRoute } from '../routes/widget.ts';
import { conversationsRoute } from '../routes/conversations.ts';
import { mountStatic } from '../routes/static.ts';

const port = Number.parseInt(process.env.E2E_PORT ?? '4173', 10);

const pg = await startPg();
console.log(`[e2e] postgres up at ${pg.url}`);
await runMigrations(pg.url);

const sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-e2e-sessions-'));

const app = new Hono();
const db = getDb(pg.url);

app.route('/api/auth', authRoute({ db }));
app.route('/api/agents', agentsRoute({ db }));
app.route('/api/conversations', conversationsRoute({ db }));
app.route(
  '/widget',
  widgetRoute({
    db,
    sessionRoot,
    // Deterministic stub for E2E so the test doesn't need network access or
    // an Anthropic API key. Production wires the real worker pool in index.ts.
    invokeAgent: async (_options, history) => {
      const last = history[history.length - 1];
      return `Echo: ${last?.content ?? ''}`;
    },
  }),
);
mountStatic(app);

const server = Bun.serve({ port, fetch: app.fetch });
console.log(`[e2e] listening on http://localhost:${server.port}`);

const shutdown = async () => {
  server.stop();
  await closeDb();
  await pg.stop();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
