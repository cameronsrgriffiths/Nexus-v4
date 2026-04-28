import { Hono } from 'hono';
import { loadEnv } from './env.ts';
import { runMigrations, getDb, closeDb } from './db/client.ts';
import { ensureBucket, checkBucket } from './storage/minio.ts';
import { checkEmbedding } from './embedding/client.ts';
import { healthRoute } from './routes/health.ts';
import { staticRoute } from './routes/static.ts';

const env = loadEnv();

await runMigrations(env.DATABASE_URL);
await ensureBucket(env);

const app = new Hono();

app.route('/healthz', healthRoute({ env, db: getDb(env.DATABASE_URL) }));
app.route('/', staticRoute());

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(JSON.stringify({ msg: 'nexus listening', port: server.port }));

const shutdown = async () => {
  server.stop();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
