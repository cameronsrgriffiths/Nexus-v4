import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const org = pgTable('org', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const health = pgTable('health', {
  id: uuid('id').primaryKey().defaultRandom(),
  ok: boolean('ok').notNull().default(true),
  bootedAt: timestamp('booted_at', { withTimezone: true }).notNull().defaultNow(),
});
