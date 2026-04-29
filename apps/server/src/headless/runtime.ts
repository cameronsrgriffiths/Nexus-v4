// Headless runtime: the single inbound + outbound entry point.
//
// Resolves a channel identifier → contact (lookup or create) → session (lookup
// or create), then either invokes the agent (inbound) or appends an
// operator-supplied assistant message (outbound proactive send).
//
// PRD invariant #10: outbound and inbound resolve through the same
// `resolveSession` code path. When a contact replies to an outbound send,
// inbound finds the same session.
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

  // Materialize the SDK cwd, build the SDK options, invoke the agent over
  // the session's full message history, and return the reply text. Does NOT
  // append the result — callers that need to attach channel-specific metadata
  // (e.g. an email Message-ID) to the assistant turn handle persistence
  // themselves.
  async function invokeOverHistory(resolved: {
    sessionId: string;
    persona: string;
    model: string;
  }): Promise<string> {
    const materialized = await materializeSession({
      sessionRoot,
      sessionId: resolved.sessionId,
      skills: [],
      subagents: [],
    });
    const options = buildSdkOptions({
      cwd: materialized.cwd,
      model: resolved.model,
      persona: resolved.persona,
    });
    const history = (await store.list(resolved.sessionId)).map(
      (m): AgentTurn => ({ role: m.role, content: m.content }),
    );
    return invokeAgent(options, history);
  }

  return {
    async handleInbound(args: InboundArgs): Promise<InboundResult> {
      const { sessionId, persona, model } = await resolveSession(args);
      const reply = await runTurn(sessionId, persona, model, args.content);
      return { sessionId, reply };
    },

    // Outbound proactive send. Resolves the session through the same code
    // path inbound uses, then appends the assistant message. The caller is
    // responsible for actually delivering the message over the channel
    // (e.g. Twilio for SMS); this method only handles the session +
    // persistence side. PRD invariant #10.
    async handleOutbound(args: InboundArgs): Promise<InboundResult> {
      const { sessionId } = await resolveSession(args);
      await store.append(sessionId, { role: 'assistant', content: args.content });
      return { sessionId, reply: args.content };
    },

    async listMessages(sessionId: string): Promise<StoredMessage[]> {
      return store.list(sessionId);
    },

    // Exposed so other channels (SMS outbound, email) and callers that need
    // just the resolver (without running a turn) can share it — invariant #10.
    resolveSession,

    // Exposed for channels that handle their own persistence (e.g. email,
    // which carries an external Message-ID on every turn).
    invokeOverHistory,
  };
}

export type HeadlessRuntime = ReturnType<typeof createHeadlessRuntime>;
