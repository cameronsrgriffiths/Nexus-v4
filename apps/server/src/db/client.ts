import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { health } from './schema.ts';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pool: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase | null = null;

export function getDb(databaseUrl: string): PostgresJsDatabase {
  if (!db) {
    pool = postgres(databaseUrl, { max: 10 });
    db = drizzle(pool);
  }
  return db;
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrator = postgres(databaseUrl, { max: 1 });
  const migratorDb = drizzle(migrator);

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '../../drizzle');
  await migrate(migratorDb, { migrationsFolder });

  const seeded = await migratorDb.select().from(health).limit(1);
  if (seeded.length === 0) {
    await migratorDb.execute(sql`INSERT INTO health DEFAULT VALUES`);
  }

  await migrator.end();
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
