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
// Mode each knowledge write used. Mirrors the service's WriteParams modes;
// kept as an enum so the write log can be queried for auto-merge eligibility
// (append-vs-append) without parsing free-form text.
export const knowledgeWriteMode = pgEnum('knowledge_write_mode', [
  'create',
  'append',
  'overwrite',
  'force',
]);
// Who issued a knowledge write. The conflict UI's audit trail needs to know
// which versions came from the agent vs. an operator so a "lost agent write"
// is identifiable after a force-overwrite.
export const knowledgeWriteActor = pgEnum('knowledge_write_actor', ['agent', 'operator']);

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

// Channel kinds the platform plans to support; only `widget` is wired in this slice.
export const channelKind = pgEnum('channel_kind', [
  'widget',
  'sms',
  'voice',
  'email',
  'telegram',
  'whatsapp',
]);

// Identifier kinds. The widget uses `widget_session_id`; later channels add the rest.
export const identifierKind = pgEnum('identifier_kind', [
  'widget_session_id',
  'phone',
  'email',
  'telegram_user_id',
  'whatsapp_user_id',
]);

export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);

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

// Append-only log of every successful knowledge_page write. Two roles:
//   1. Auto-merge eligibility — the operator UI auto-merges append-vs-append
//      conflicts; to know a stretch of intervening writes is all `append`,
//      we look them up here by (page_id, version_after).
//   2. Audit trail for "lost" agent writes — when the operator force-saves
//      after an agent overwrite, the agent's write row stays in this log
//      forever; that row IS the audit record.
export const knowledgeWriteLog = pgTable(
  'knowledge_write_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => knowledgePage.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    versionAfter: integer('version_after').notNull(),
    mode: knowledgeWriteMode('mode').notNull(),
    actor: knowledgeWriteActor('actor').notNull(),
    contentAfter: text('content_after').notNull(),
    // Marks rows recording an agent write that was overwritten by a force
    // commit. Null on every other row. Set by the operator save handler when
    // it commits a force; the row referenced is the latest log entry that
    // existed before the force ran.
    lostToForceById: uuid('lost_to_force_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageVersionIdx: index('knowledge_write_log_page_version_idx').on(t.pageId, t.versionAfter),
  }),
);

// Channel: an addressable surface (one row per agent×channel binding). For the
// widget, every agent installation has its own channel row; later channels
// (SMS, voice, etc.) follow the same pattern. `address` is the channel-side
// handle the platform owns — the Twilio phone number for SMS, the reply-from
// email for an email channel, etc. NULL for widget channels (the widget id IS
// the channel id). `mailtrapInboxId` is email-specific; Mailtrap's HTTP API
// uses it as a path param for inbox polling, so it can't collapse into
// `address`.
export const channel = pgTable(
  'channel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    kind: channelKind('kind').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
    address: text('address'),
    mailtrapInboxId: text('mailtrap_inbox_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Prevents two channels of the same kind from claiming the same address
    // (e.g. two SMS channels on the same Twilio number) so inbound resolution
    // is unambiguous.
    kindAddressUnique: uniqueIndex('channel_kind_address_unique').on(t.kind, t.address),
  }),
);

// Contact: a person/end-user. Identifiers below carry the channel-specific
// addresses that resolve to a contact. `do_not_contact` is honored by every
// outbound code path.
export const contact = pgTable('contact', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  doNotContact: boolean('do_not_contact').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Identifier: a typed handle for a contact (phone, email, widget session id…).
// Unique on (kind, value) so the same handle can't point at two contacts.
export const identifier = pgTable(
  'identifier',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    kind: identifierKind('kind').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindValueUnique: uniqueIndex('identifier_kind_value_unique').on(t.kind, t.value),
  }),
);

// Agent conversation session: one ongoing thread between a contact and an
// agent on a particular channel. Named `agent_session` because the existing
// `session` table holds operator HTTP sessions.
export const agentSession = pgTable('agent_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agent.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channel.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contact.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Agent message: append-only log of turns within a session. PRD invariant #5
// requires monotonic, gap-free sequence numbers — enforced in session-store.ts
// and pinned by a unique index on (session, sequence).
//
// `externalId` carries the channel-specific message id used for threading
// (e.g. an email Message-ID). Nullable because not every channel needs it.
export const agentMessage = pgTable(
  'agent_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionSequenceUnique: uniqueIndex('agent_message_session_sequence_unique').on(
      t.sessionId,
      t.sequence,
    ),
  }),
);

// Inbound dedupe for poll-based channels. The email poller writes one row per
// (channel, mailtrap message id) so a re-poll doesn't re-dispatch a message
// already handled. Unique index makes the insert idempotent.
export const channelInboundSeen = pgTable(
  'channel_inbound_seen',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelExternalUnique: uniqueIndex('channel_inbound_seen_channel_external_unique').on(
      t.channelId,
      t.externalId,
    ),
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
