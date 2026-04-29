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
import * as v from 'valibot';
import { startPg } from './pg-container.ts';
import { runMigrations, getDb, closeDb } from '../db/client.ts';
import { authRoute } from '../routes/auth.ts';
import { agentsRoute } from '../routes/agents.ts';
import { widgetRoute } from '../routes/widget.ts';
import { conversationsRoute } from '../routes/conversations.ts';
import { channelsRoute } from '../routes/channels.ts';
import { emailRoute } from '../routes/email.ts';
import { knowledgeRoute } from '../routes/knowledge.ts';
import { mountStatic } from '../routes/static.ts';
import { createCredentialService } from '../credentials/service.ts';
import { createHeadlessRuntime } from '../headless/runtime.ts';
import { smsRoute } from '../sms/route.ts';
import { createKnowledgeService } from '../knowledge/service.ts';
import { fakeEmbedder } from '../knowledge/test-helpers.ts';
import { agentWrite } from '../knowledge/operator.ts';

const port = Number.parseInt(process.env.E2E_PORT ?? '4173', 10);

const pg = await startPg();
console.log(`[e2e] postgres up at ${pg.url}`);
await runMigrations(pg.url);

const sessionRoot = await mkdtemp(join(tmpdir(), 'nexus-e2e-sessions-'));

const app = new Hono();
const db = getDb(pg.url);

// 32-byte key, base64-encoded — only used by the e2e suite.
const credentials = createCredentialService({
  db,
  encryptionKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
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

// Knowledge service uses the deterministic fake embedder so the E2E doesn't
// need the real embedding container running. The conflict UI doesn't depend
// on semantic recall — only on FTS / version logic — so this is safe.
const knowledgeService = createKnowledgeService({ db, embedder: fakeEmbedder() });

app.route('/api/auth', authRoute({ db }));
app.route('/api/agents', agentsRoute({ db }));
app.route('/api/conversations', conversationsRoute({ db }));
app.route('/api/channels', channelsRoute({ db, credentials }));
app.route('/api/email', emailRoute({ db, credentials }));
app.route('/api/knowledge', knowledgeRoute({ db, service: knowledgeService }));

// E2E-only test API. The conflict spec needs to (a) seed an existing page
// the operator can load, then (b) trigger an agent overwrite between the
// operator's load and save. The operator's auth cookie isn't enough — the
// write needs to be attributed to the agent, which the operator routes
// can't do. Mounted only here so production never exposes it.
app.post('/api/_test/knowledge', async (c) => {
  const body = await c.req.json().catch(() => null);
  const TestBody = v.object({
    orgId: v.pipe(v.string(), v.minLength(1)),
    scope: v.picklist(['org', 'agent', 'contact'] as const),
    scopeId: v.pipe(v.string(), v.minLength(1)),
    title: v.pipe(v.string(), v.minLength(1)),
    mode: v.picklist(['create', 'append', 'overwrite'] as const),
    content: v.string(),
    version: v.optional(v.pipe(v.number(), v.integer())),
  });
  const parsed = v.safeParse(TestBody, body);
  if (!parsed.success) return c.json({ error: 'invalid_test_body' }, 400);
  const o = parsed.output;
  const params =
    o.mode === 'create'
      ? { scope: o.scope, scopeId: o.scopeId, mode: 'create' as const, title: o.title, content: o.content }
      : {
          scope: o.scope,
          scopeId: o.scopeId,
          mode: o.mode,
          title: o.title,
          content: o.content,
          version: o.version ?? 1,
        };
  const result = await agentWrite({ db, service: knowledgeService, orgId: o.orgId, params });
  return c.json(result, result.ok ? 200 : 409);
});

// Helper for the spec to pull the operator's org id without leaking the
// session-cookie internals into Playwright. Returns the org id of the
// signed-in user, identified by email.
app.get('/api/_test/org-id', async (c) => {
  const email = c.req.query('email');
  if (!email) return c.json({ error: 'missing_email' }, 400);
  const { sql } = await import('drizzle-orm');
  const rows = await db.execute<{ org_id: string }>(
    sql`SELECT org_id FROM "user" WHERE email = ${email} LIMIT 1`,
  );
  const row = rows[0] as { org_id: string } | undefined;
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ orgId: row.org_id }, 200);
});

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
