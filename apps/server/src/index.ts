import { Hono } from 'hono';
import { requestLogger } from '@nexus/logger/hono';
import { loadEnv } from './env.ts';
import { runMigrations, getDb, closeDb } from './db/client.ts';
import { ensureBucket } from './storage/minio.ts';
import { healthRoute } from './routes/health.ts';
import { staticRoute } from './routes/static.ts';
import { log } from './logger.ts';

const env = loadEnv();

await runMigrations(env.DATABASE_URL);
await ensureBucket(env);

const app = new Hono();

app.use('*', requestLogger({ logger: log }));
app.route('/healthz', healthRoute({ env, db: getDb(env.DATABASE_URL) }));
app.route('/', staticRoute());

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
