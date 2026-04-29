// Minimal end-to-end server that backs the Playwright test:
//   - Boots a Postgres container.
//   - Runs Drizzle migrations.
//   - Serves the auth API and the built Vite dist on a single port.
//
// Started by playwright.config.ts via the webServer option, killed when the
// run finishes.

import { Hono } from 'hono';
import { startPg } from './pg-container.ts';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { authRoute } from '../routes/auth.ts';
import { mountStatic } from '../routes/static.ts';

const port = Number.parseInt(process.env.E2E_PORT ?? '4173', 10);

const pg = await startPg();
console.log(`[e2e] postgres up at ${pg.url}`);
await runMigrations(pg.url);

const app = new Hono();
const db = getDb(pg.url);

app.route('/api/auth', authRoute({ db }));
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
