import { Hono } from 'hono';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestLogger } from '@nexus/logger/hono';
import { log } from './logger.ts';
import { loadEnv } from './env.ts';
import { runMigrations, getDb, closeDb } from './db/client.ts';
import { ensureBucket } from './storage/minio.ts';
import { healthRoute } from './routes/health.ts';
import { mountStatic } from './routes/static.ts';
import { createCredentialService } from './credentials/service.ts';
import { authRoute } from './routes/auth.ts';
import { agentsRoute } from './routes/agents.ts';
import { widgetRoute } from './routes/widget.ts';
import { conversationsRoute } from './routes/conversations.ts';
import { channelsRoute } from './routes/channels.ts';
import { emailRoute } from './routes/email.ts';
import { knowledgeRoute } from './routes/knowledge.ts';
import { createWorkerPool } from './headless/worker-pool.ts';
import { createHeadlessRuntime } from './headless/runtime.ts';
import { smsRoute } from './sms/route.ts';
import { createKnowledgeService } from './knowledge/service.ts';
import { createHttpEmbedder } from './embedding/client.ts';

const env = loadEnv();

await runMigrations(env.DATABASE_URL);
await ensureBucket(env);

const db = getDb(env.DATABASE_URL);
// Instantiating here surfaces a bad CREDENTIAL_ENCRYPTION_KEY at startup
// rather than on first credential write.
const credentials = createCredentialService({
  db,
  encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
});

// Per-session SDK working directories live under sessionRoot. Its ancestors
// are the runtime data dir and the project root — neither contains SDK
// configuration, so the materializer's ancestor-sanitation passes (PRD #2).
const here = dirname(fileURLToPath(import.meta.url));
const sessionRoot = resolve(here, '..', '..', '..', '.nexus-runtime', 'sessions');
await mkdir(sessionRoot, { recursive: true });

const workerPath = resolve(here, 'headless', 'worker.ts');
const workerPool = createWorkerPool({ workerPath });

const app = new Hono();

// One runtime instance shared across the widget and SMS channels — both go
// through the same resolveSession code path (PRD invariant #10).
const invokeAgent = (
  options: Parameters<typeof workerPool.dispatch>[1],
  history: Parameters<typeof workerPool.dispatch>[2],
) =>
  // The session id IS the cwd's last path segment — keep it as the worker
  // pool key so each session has its own Worker (PRD per-session crash
  // isolation).
  workerPool.dispatch(options.cwd, options, history);
const runtime = createHeadlessRuntime({ db, sessionRoot, invokeAgent });

app.use('*', requestLogger({ logger: log }));
app.route('/healthz', healthRoute({ env, db }));
app.route('/api/auth', authRoute({ db }));
app.route('/api/agents', agentsRoute({ db }));
app.route('/api/conversations', conversationsRoute({ db }));
app.route('/api/channels', channelsRoute({ db, credentials }));
app.route('/api/email', emailRoute({ db, credentials }));
app.route(
  '/api/knowledge',
  knowledgeRoute({
    db,
    service: createKnowledgeService({
      db,
      embedder: createHttpEmbedder({ baseUrl: env.EMBEDDING_URL }),
    }),
  }),
);
app.route('/widget', widgetRoute({ db, sessionRoot, invokeAgent }));
app.route('/sms', smsRoute({ db, credentials, runtime }));
mountStatic(app);

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

log.info('nexus listening', { port: server.port });

const shutdown = async () => {
  server.stop();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
