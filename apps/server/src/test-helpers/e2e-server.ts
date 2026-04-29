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
import { channelsRoute } from '../routes/channels.ts';
import { mountStatic } from '../routes/static.ts';
import { createCredentialService } from '../credentials/service.ts';
import { createHeadlessRuntime } from '../headless/runtime.ts';
import { smsRoute } from '../sms/route.ts';

const port = Number.parseInt(process.env.E2E_PORT ?? '4173', 10);

const pg = await startPg();
console.log(`[e2e] postgres up at ${pg.url}`);
await runMigrations(pg.url);

const sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-e2e-sessions-'));

const app = new Hono();
const db = getDb(pg.url);

// Test-only encryption key (32 zero bytes base64). Production wires through env.
const credentials = createCredentialService({
  db,
  encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
});

// Deterministic stub for E2E so the test doesn't need network access or an
// Anthropic API key. Production wires the real worker pool in index.ts.
const invokeAgent = async (
  _options: { cwd: string },
  history: Array<{ role: string; content: string }>,
) => {
  const last = history[history.length - 1];
  return `Echo: ${last?.content ?? ''}`;
};
const runtime = createHeadlessRuntime({ db, sessionRoot, invokeAgent });

// Stub the Twilio outbound HTTP for the same reason we stub `invokeAgent`
// above: real Twilio API access in CI would burn credentials and add
// flake. The wire shape is exercised by integration tests; the e2e proves
// the operator UI and the inbound flow end-to-end.
const twilioFetch = async () =>
  new Response(JSON.stringify({ sid: 'SMe2e-stub' }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });

app.route('/api/auth', authRoute({ db }));
app.route('/api/agents', agentsRoute({ db }));
app.route('/api/conversations', conversationsRoute({ db }));
app.route('/api/channels', channelsRoute({ db, credentials }));
app.route('/widget', widgetRoute({ db, sessionRoot, invokeAgent }));
app.route('/sms', smsRoute({ db, credentials, runtime, twilioFetch }));
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
