// Headless runtime: the single inbound entry point.
//
// Resolves a channel identifier → contact (lookup or create) → session (lookup
// or create), persists the user turn, invokes the agent, persists the
// assistant turn, returns the reply.
//
// PRD invariant #10: outbound message-send (#10) reuses this exact resolver
// and append-and-invoke flow. Keep `resolveSession` and `runTurn` as the
// single shared entry points so the outbound path can call them directly
// once it lands.
//
// PRD invariants honored here:
//   #1 / #2: each call materializes a fresh per-session SDK working directory
//            via materialize.ts, which performs the ancestor-sanitation check.
//   #3:      SDK options are constructed exclusively through buildSdkOptions,
//            which pins `settingSources: ['project']`.
//   #5:      message persistence uses the append-only session store; no
//            caller-supplied sequence numbers.
//   #9:      agent rows are read fresh from Postgres on every turn — the
//            filesystem is materialized on demand, not retained.

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  agent as agentTable,
  agentSession,
  channel as channelTable,
  contact as contactTable,
  identifier as identifierTable,
} from '../db/schema.ts';
import { materializeSession } from './materialize.ts';
import { buildSdkOptions, type SdkOptions } from './sdk-options.ts';
import { createSessionStore, type SessionStore, type StoredMessage } from './session-store.ts';

export type AgentTurn = { role: 'user' | 'assistant' | 'system'; content: string };
export type InvokeAgent = (options: SdkOptions, history: AgentTurn[]) => Promise<string>;

export type InboundArgs = {
  channelId: string;
  identifierKind: 'widget_session_id' | 'phone' | 'email' | 'telegram_user_id' | 'whatsapp_user_id';
  identifierValue: string;
  content: string;
};

export type InboundResult = {
  sessionId: string;
  reply: string;
};

type Deps = {
  db: PostgresJsDatabase;
  sessionRoot: string;
  invokeAgent: InvokeAgent;
};

export function createHeadlessRuntime({ db, sessionRoot, invokeAgent }: Deps) {
  const store: SessionStore = createSessionStore({ db });

  async function resolveContactId(
    orgId: string,
    kind: InboundArgs['identifierKind'],
    value: string,
  ): Promise<string> {
    const [existing] = await db
      .select({ contactId: identifierTable.contactId })
      .from(identifierTable)
      .where(and(eq(identifierTable.kind, kind), eq(identifierTable.value, value)))
      .limit(1);
    if (existing) return existing.contactId;

    const [created] = await db.insert(contactTable).values({ orgId }).returning();
    await db.insert(identifierTable).values({ contactId: created!.id, kind, value });
    return created!.id;
  }

  async function resolveSession(args: InboundArgs): Promise<{
    sessionId: string;
    agentId: string;
    persona: string;
    model: string;
  }> {
    const [ch] = await db
      .select()
      .from(channelTable)
      .where(eq(channelTable.id, args.channelId))
      .limit(1);
    if (!ch) throw new Error(`unknown channel: ${args.channelId}`);

    const [a] = await db.select().from(agentTable).where(eq(agentTable.id, ch.agentId)).limit(1);
    if (!a) throw new Error(`agent missing for channel ${ch.id}`);

    const contactId = await resolveContactId(ch.orgId, args.identifierKind, args.identifierValue);

    const [existing] = await db
      .select()
      .from(agentSession)
      .where(
        and(eq(agentSession.channelId, ch.id), eq(agentSession.contactId, contactId)),
      )
      .limit(1);
    if (existing) {
      return { sessionId: existing.id, agentId: a.id, persona: a.persona, model: a.model };
    }

    const [created] = await db
      .insert(agentSession)
      .values({ orgId: ch.orgId, agentId: a.id, channelId: ch.id, contactId })
      .returning();
    return { sessionId: created!.id, agentId: a.id, persona: a.persona, model: a.model };
  }

  async function runTurn(
    sessionId: string,
    persona: string,
    model: string,
    userContent: string,
  ): Promise<string> {
    await store.append(sessionId, { role: 'user', content: userContent });

    // Materialize a fresh SDK cwd for this turn. Skills + sub-agents are
    // sourced from Postgres (none in this slice); future slices will load
    // them from the agent definition.
    const materialized = await materializeSession({
      sessionRoot,
      sessionId,
      skills: [],
      subagents: [],
    });
    const options = buildSdkOptions({ cwd: materialized.cwd, model, persona });

    const history = (await store.list(sessionId)).map(
      (m): AgentTurn => ({ role: m.role, content: m.content }),
    );
    const reply = await invokeAgent(options, history);

    await store.append(sessionId, { role: 'assistant', content: reply });
    return reply;
  }

  return {
    async handleInbound(args: InboundArgs): Promise<InboundResult> {
      const { sessionId, persona, model } = await resolveSession(args);
      const reply = await runTurn(sessionId, persona, model, args.content);
      return { sessionId, reply };
    },

    async listMessages(sessionId: string): Promise<StoredMessage[]> {
      return store.list(sessionId);
    },

    // Exposed so future code (outbound send in #10) can share the resolver.
    resolveSession,
  };
}
