import { Hono } from 'hono';
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

const env = loadEnv();

await runMigrations(env.DATABASE_URL);
await ensureBucket(env);

const db = getDb(env.DATABASE_URL);
// Instantiating here surfaces a bad CREDENTIAL_ENCRYPTION_KEY at startup
// rather than on first credential write.
createCredentialService({ db, encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY });

const app = new Hono();

app.use('*', requestLogger({ logger: log }));
app.route('/healthz', healthRoute({ env, db }));
app.route('/api/auth', authRoute({ db }));
app.route('/api/agents', agentsRoute({ db }));
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
