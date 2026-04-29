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
} from 'drizzle-orm/pg-core';

export const runtimeMode = pgEnum('runtime_mode', ['headless', 'dedicated']);

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

// Channel: an addressable surface (one row per agent×channel binding). For the
// widget, every agent installation has its own channel row; later channels
// (SMS, voice, etc.) follow the same pattern.
export const channel = pgTable('channel', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => org.id, { onDelete: 'cascade' }),
  kind: channelKind('kind').notNull(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agent.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionSequenceUnique: uniqueIndex('agent_message_session_sequence_unique').on(
      t.sessionId,
      t.sequence,
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
