import { Hono } from 'hono';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { health } from '../db/schema.ts';
import { checkBucket } from '../storage/minio.ts';
import { checkEmbedding } from '../embedding/client.ts';
import type { Env } from '../env.ts';

type Deps = {
  env: Env;
  db: PostgresJsDatabase;
};

export function healthRoute({ env, db }: Deps) {
  const router = new Hono();

  router.get('/', async (c) => {
    const [postgres, minio, embedding] = await Promise.all([
      checkPostgres(db),
      checkBucket(env),
      checkEmbedding(env.EMBEDDING_URL),
    ]);

    const ok = postgres.ok && minio.ok && embedding.ok;
    return c.json(
      {
        ok,
        postgres,
        minio,
        embedding,
      },
      ok ? 200 : 503,
    );
  });

  return router;
}

async function checkPostgres(db: PostgresJsDatabase): Promise<{ ok: boolean; error?: string }> {
  try {
    const rows = await db.select().from(health).limit(1);
    if (rows.length === 0) {
      return { ok: false, error: 'health table empty' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
