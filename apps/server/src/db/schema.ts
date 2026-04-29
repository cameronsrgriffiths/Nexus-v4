import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  customType,
  uniqueIndex,
  pgEnum,
  integer,
  index,
} from 'drizzle-orm/pg-core';

export const runtimeMode = pgEnum('runtime_mode', ['headless', 'dedicated']);
export const knowledgeScope = pgEnum('knowledge_scope', ['org', 'agent', 'contact']);

const tsvector = customType<{ data: string; default: false }>({
  dataType() {
    return 'tsvector';
  },
});

// pgvector with a fixed dimension. nomic-embed-text-v1.5 produces 768-dim vectors.
const vector768 = customType<{ data: number[]; default: false }>({
  dataType() {
    return 'vector(768)';
  },
  toDriver(value: number[]) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown) {
    if (Array.isArray(value)) return value as number[];
    if (typeof value === 'string') {
      return JSON.parse(value) as number[];
    }
    return [];
  },
});

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

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
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const health = pgTable('health', {
  id: uuid('id').primaryKey().defaultRandom(),
  ok: boolean('ok').notNull().default(true),
  bootedAt: timestamp('booted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agent = pgTable('agent', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  persona: text('persona').notNull(),
  model: text('model').notNull(),
  runtimeMode: runtimeMode('runtime_mode').notNull().default('headless'),
  voiceEnabled: boolean('voice_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgePage = pgTable(
  'knowledge_page',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    scope: knowledgeScope('scope').notNull(),
    // For org-scoped pages this is the org id; for agent/contact scopes it's the
    // owning agent or contact id. Keeping it as a single uuid column lets us
    // index (org_id, scope, scope_id, title) for unique-title-per-scope and
    // for fast scope lookups without joining through scope-specific tables.
    scopeId: uuid('scope_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    version: integer('version').notNull().default(1),
    // FTS index column. The knowledge service computes it from title+content
    // on every write so search and write share a single transactional path.
    tsv: tsvector('tsv').notNull(),
    embedding: vector768('embedding').notNull(),
    // When this page has been moved (scope change), points at the new page id.
    // Writers targeting the old id receive a `page_moved` response with the
    // new coordinates and retry against the new location.
    movedTo: uuid('moved_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeTitleUnique: uniqueIndex('knowledge_page_scope_title_unique').on(
      t.orgId,
      t.scope,
      t.scopeId,
      t.title,
    ),
    scopeIdx: index('knowledge_page_scope_idx').on(t.orgId, t.scope, t.scopeId),
  }),
);

export const credential = pgTable(
  'credential',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    value: bytea('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProviderNameUnique: uniqueIndex('credential_org_provider_name_unique').on(
      t.orgId,
      t.provider,
      t.name,
    ),
  }),
);
