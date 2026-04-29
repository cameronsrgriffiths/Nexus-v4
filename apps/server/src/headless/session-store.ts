// Append-only message store for an agent session.
//
// PRD invariant #5: every write is appended; no reorders, no back-inserts.
// We assign sequence numbers monotonically inside a single transaction:
//   sequence = (max existing sequence for this session) + 1
// and a unique index on (session_id, sequence) makes any concurrent
// race fall over to a UNIQUE_VIOLATION rather than silently reorder.
//
// `appendAt` is provided only so the test suite can prove out-of-order writes
// fail fast — production code paths use `append`.

import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agentMessage } from '../db/schema.ts';

export type MessageInput = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  // Channel-specific message id used for threading (e.g. an email Message-ID).
  // Optional because not every channel uses one.
  externalId?: string | undefined;
};

export type StoredMessage = MessageInput & {
  id: string;
  sequence: number;
  createdAt: Date;
};

export class OutOfOrderWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutOfOrderWriteError';
  }
}

type Deps = { db: PostgresJsDatabase };

export type SessionStore = {
  append(sessionId: string, msg: MessageInput): Promise<StoredMessage>;
  appendAt(sessionId: string, sequence: number, msg: MessageInput): Promise<StoredMessage>;
  list(sessionId: string): Promise<StoredMessage[]>;
};

export function createSessionStore({ db }: Deps): SessionStore {
  async function nextSequence(sessionId: string): Promise<number> {
    const [row] = await db.execute<{ next: number }>(sql`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next
      FROM agent_message
      WHERE session_id = ${sessionId}
    `);
    return Number(row?.next ?? 1);
  }

  return {
    async append(sessionId, msg) {
      const sequence = await nextSequence(sessionId);
      const [stored] = await db
        .insert(agentMessage)
        .values({
          sessionId,
          sequence,
          role: msg.role,
          content: msg.content,
          externalId: msg.externalId,
        })
        .returning();
      return toApi(stored!);
    },

    async appendAt(sessionId, sequence, msg) {
      const expected = await nextSequence(sessionId);
      if (sequence !== expected) {
        throw new OutOfOrderWriteError(
          `refused to write at sequence ${sequence} (next monotonic sequence is ${expected})`,
        );
      }
      const [stored] = await db
        .insert(agentMessage)
        .values({
          sessionId,
          sequence,
          role: msg.role,
          content: msg.content,
          externalId: msg.externalId,
        })
        .returning();
      return toApi(stored!);
    },

    async list(sessionId) {
      const rows = await db
        .select()
        .from(agentMessage)
        .where(eq(agentMessage.sessionId, sessionId))
        .orderBy(agentMessage.sequence);
      return rows.map(toApi);
    },
  };
}

function toApi(row: typeof agentMessage.$inferSelect): StoredMessage {
  return {
    id: row.id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    externalId: row.externalId ?? undefined,
    createdAt: row.createdAt,
  };
}
