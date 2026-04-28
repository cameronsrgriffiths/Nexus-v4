import type { Config } from 'drizzle-kit';

export default {
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://nexus:nexus@localhost:5432/nexus',
  },
} satisfies Config;
