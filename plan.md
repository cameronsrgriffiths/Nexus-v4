# Nexus V3

## What is Nexus?

Nexus is a platform for building, hosting, and operating AI agents. You create agents with their own personalities, knowledge, and skills, then connect them to the outside world through channels like SMS, voice calls, email, web chat widgets, Telegram, and WhatsApp.

Nexus works two ways:
- **Centralized SaaS** — we host it, organizations sign up and use it
- **Self-hosted open-source** — anyone can download it and run it themselves

The Nexus web UI is where you build and operate your agents. But the people who actually *use* your agents usually never see Nexus — they interact through a chat widget on your website, a phone call, a text message, or any other channel you've set up.

---

## Organizations & Users

### Organizations

An organization is the top-level boundary in Nexus. Everything lives inside an org: users, agents, teams, channels, knowledge, and routing rules. Organizations are completely isolated from each other — no data crosses org boundaries.

For self-hosted deployments, there's typically one organization (yours). For the centralized SaaS, many organizations share the same Nexus infrastructure but never see each other's data.

### Users & Permissions

Permissions live at two levels: **organization-level** (what you can do across the whole org) and **agent-level** (what you can do on a specific agent).

**Super admins.** The person who creates an organization is its super admin. Super admins have every permission at every level, implicitly. They can create and manage users, grant or revoke any org-level permission, access and administer every agent regardless of who created it, and promote other users to super admin.

**Users are linked to contacts.** Every Nexus user account is tied to exactly one contact record in the org's contact directory. When a super admin creates a new user, they either create a fresh contact alongside the user (the default, flagged internal) or link the user to an existing contact (useful when the person was already a customer, partner, or other external contact before being onboarded as an operator). This linkage is what lets operator-direct sessions behave like any other contact-attached session — see *Contacts > Contact creation* and *The Nexus UI > Chat and voice are operator access*.

**Organization-level permissions.** A super admin can grant users any subset of these org-wide permissions:

- **Can create agents**
- **Can create and manage teams** — create teams, edit team-level settings, add/remove member agents, delete teams
- **Can create channels**
- **Can edit channels** *(two-key — see below)*
- **Can edit routing rules** *(two-key — see below)*
- **Can create and edit contacts**
- **Admin of new agents** — a simple on/off flag. When on, the user is automatically made admin of every new agent created in the org. (Future versions may support more granular rules, such as auto-admin only for agents created by specific users. For now it's all-or-nothing.)
- **Can edit user permissions** — grant or revoke org-level permissions for other users
- **Can grant elevated knowledge access** — turn on knowledge reach extensions for agents (see *Knowledge policy*). Only super admins hold this by default.
- **Can edit any scheduled task** — edit or delete any scheduled task in the org, not just ones the user created (see *Scheduling*).
- **Can edit workflows** — create, edit, or delete automation workflows in the org's workflow engine (see *Automations*).
- **Can erase contacts** — perform a full per-contact erasure (right-to-be-forgotten): remove a specific contact and all data tied to them. Only super admins hold this by default; super admins can grant it to others. See *Retention and deletion*.

Others can be added as the product grows.

**Agent-level permissions.** Each agent carries its own set of permissions that apply only to that agent. An agent admin (or anyone granted authority to manage permissions on that agent) can assign other users either:

- A **named role** as a convenient preset:
  - **Viewer** — read-only access (browse sessions, history, knowledge)
  - **Operator** — everything a viewer can do, plus participate in sessions
  - **Admin** — full control of this agent (every agent-level permission)
- Or a **custom permission set** — pick permissions one by one. Examples:
  - Read conversations
  - Participate in sessions
  - Edit the agent definition
  - **Edit channels** (agent side of the two-key check)
  - **Edit routing rules** (agent side of the two-key check)
  - Destroy agent instances

The creator of an agent is automatically its admin. Regular users only see and interact with agents they've been granted permission on; which features they can use on a given agent depends on which permissions they hold there.

**The two-key check.** Some actions require permissions at *both* levels — the organization-level permission *and* the agent-level permission on every agent affected by the action. This prevents someone with a broad org permission from reaching into an agent they don't have local authority over, and prevents an agent admin from affecting other agents. The check applies to:

- **Creating a channel** (including its initial routing) — org "can create channels" + agent "edit channels" on every agent the new channel will route to.
- **Editing a channel's credentials or settings** — org "can edit channels" + agent "edit channels" on every agent the channel's routing currently touches.
- **Editing a channel's routing after creation** — org "can edit routing rules" + agent "edit routing rules" on every agent the routing affects, both before and after the change.
- **Deleting a channel** — org "can edit channels" + agent "edit channels" on every agent its routing touches.
- **Creating, editing, or deleting a group chat** — org "can create agents" (same permission that governs creating agent-level configuration like seed sessions) + agent-level "edit the agent definition" on every agent affected by the change: the designated agent plus every participant agent (both before and after the change, so adding or removing a participant requires the check on that agent too). This is the same shape as the channel two-key check, extended to every participant — an N-key check when a chat has many participants. Reassigning the designated agent checks both the outgoing and incoming designated agents.

---

## Agents

### What is an agent?

An agent is a persona with a runtime — a distinct identity that has its own personality, voice, skills, knowledge access, and a defined way of running. Think of an agent as an AI employee with a job, a way of speaking, and a computer to work on.

An agent has:

- **A name** — "Sales Rep," "Receptionist," "Code Assistant"
- **A text persona** — How it communicates in text (system prompt, personality, instructions)
- **A voice persona** — How it sounds and behaves on voice calls (voice selection, speaking style, voice engine)
- **Skills** — Specialized capabilities it can invoke (research, data analysis, etc.)
- **Sub-agents** — Other agents it can delegate work to
- **Peer directory** — Other agents it can message directly or invite into group chats (see *Agent-to-agent messaging*)
- **A runtime mode** — How the agent actually runs (see *Agent runtime modes*)
- **Optional team membership** — Which team the agent belongs to, if any (see *Teams*)

An agent can be text-only (no voice), voice-only (like a receptionist that only handles calls), or both.

### Agent runtime modes

Every agent runs in one of two modes at launch:

- **Headless** — The agent runs directly on the Nexus server using the Claude Agent SDK. No container, no filesystem, no shell. The agent can access knowledge, MCP integrations, web search, and other server-side tools. Best for chatbots, voice agents, customer support, receptionists, and Q&A agents.
- **Dedicated** — The agent runs inside its own Docker container with the Claude Agent SDK inside it. The container gives the agent direct access to native tools (file editing, terminal, and optionally a browser). Every dedicated agent has its own container. Best for coding agents, research agents, and agents that need to interact with a real environment.

A third runtime mode — **shared**, where multiple agents share a single container for compute efficiency — is planned as a future enhancement (see *FUTURE_PRD.md F14*). At launch, every dedicated agent gets its own container.

No custom agent loop is built. The Claude Agent SDK brings its own loop. Nexus focuses on the platform around the agent, not the agent loop itself.

### AI provider support

Nexus runs on the Claude Agent SDK for both headless and dedicated modes at launch. The platform around the agent — routing, channels, knowledge, UI — is built to be provider-agnostic, and the runtime layer is structured so adding a second provider later is additive rather than a restructure. But the launch product is Claude-only; multi-provider support is a planned future direction (see *FUTURE_PRD.md F11*).

- **Dedicated** — The Claude Agent SDK runs inside the container with Claude Code's native tools (Read, Write, Edit, Bash, Glob, Grep, WebSearch, etc.). This is the gold standard experience — Claude was specifically trained on these tools and performs best with them. A thin adapter (the bridge) inside the container translates between Nexus's protocol and the SDK; the rest of the system sits above the bridge and doesn't care about its internals.
- **Headless** — The Claude Agent SDK runs directly on the Nexus server with native filesystem/shell tools disabled. Only server-side tools (knowledge, search, MCP, etc.) are exposed to the agent. Gets Claude's sophisticated agentic loop without needing a container.

### Container capabilities (dedicated agents)

Dedicated agents declare a capability level for their container:

- **Minimal** — Filesystem and shell only. Good for coding agents, data processing, script-running, and agents that need Bash but no browser. Minimal is the default.
- **Desktop** — Adds a browser (Chromium), a graphical desktop (Xvfb/VNC), and display tools for browser automation and computer use. Higher baseline compute cost (Chromium + Xvfb + VNC add roughly 1-2GB RAM of idle overhead per container), so desktop is opt-in.

Headless agents have no container capability — the setting doesn't apply.

### Browser automation and computer use

Dedicated agents with desktop capability get two levels of visual interaction:

**Browser automation** — The agent can control a Chromium browser inside the container: navigate to URLs, click elements, fill forms, read page content, and take screenshots. Two approaches are available:
- **Accessibility-tree based** — The browser's accessibility tree is flattened into numbered interactive elements (`[1] button "Sign in"`, `[2] input "Email"`). The agent clicks by index or role+name. Robust against site redesigns, token-efficient, and the approach most modern browser automation has converged on.
- **Claude's native tools** — The Claude Agent SDK includes native browser and computer use tools that the model was trained on. Where possible, Nexus uses these native tools for the best agent performance.

**Computer use** — The agent can control the entire desktop environment inside the container: click anywhere on screen, type, drag, use keyboard shortcuts, interact with any GUI application — not just the browser. This uses the Claude Agent SDK's native computer use capability when available, with the container's display (Xvfb/VNC) as the target.

**What operators see** — The Nexus UI's browser panel shows the container's desktop in real-time via VNC. Operators can watch the agent work, see what it's clicking, and observe the state of the browser or any other application. This is a live view — the operator sees exactly what the agent sees.

### The tool daemon

Every dedicated-agent container runs a tool daemon alongside the agent. The tool daemon is **not** for the agent — it's for the Nexus UI. It's what allows operators to browse files, use the terminal, and see the browser view when looking at an agent in the Nexus web app. It also enables the knowledge system to read/write files in the container when needed.

Headless agents have no tool daemon — there's no container for it to live in. File, terminal, and browser panels are simply absent from the UI for headless agents.

### Storage and runtime lifecycle

Dedicated agents have two settings that configure the container:

- **Storage**
  - **Persistent** — changes to the container's filesystem (files created, edits made, state accumulated) survive restarts. The agent has memory of prior activity at the filesystem level.
  - **Ephemeral** — every start begins with a fresh filesystem from the container image. Good for reproducible, stateless work.

- **Runtime lifecycle**
  - **Always on** — the container stays running. No startup latency for inbound messages. Continuous compute cost.
  - **Sleep when idle** — the container shuts down after a period of inactivity and is restarted on the next inbound message. Adds a short cold-start latency but avoids paying for idle compute.

Neither setting applies to headless agents. "Storage" for a headless agent is effectively the knowledge system on the server, which is always persistent. Runtime is effectively on-demand — there's no long-running container to keep alive; the server-side runtime spins up per session and tears down when the session ends. The agent-definition form omits these settings entirely for headless agents.

Per-contact agent instances (see *Routing > Per-contact instance*) inherit the dedicated agent's storage and lifecycle settings, and carry additional lifecycle controls — idle destroy, quota, warm pool — described in *Routing > Per-contact instance lifecycle*.

### Agent instances

An **agent definition** is the template: persona, skills, runtime mode, storage and lifecycle choices, and other configuration. An **agent instance** is an actual running realization of that definition — the container for dedicated agents, or the running SDK session for headless agents. A single agent definition can have one or many live instances simultaneously.

Most agents have a single instance named `main` that all messages flow into. A **per-contact** agent gets a separate instance for each contact (see *Routing > Per-contact instance*). Operators can also create explicitly named instances for specific purposes (staging, VIP tier, etc.) by setting up routing that targets those names.

### Managing agent definitions

Operators create and edit agents from the Nexus UI:

- **Name** — The agent's display name
- **Text persona** — The system prompt and instructions for text conversations. Edited in a built-in text editor (markdown).
- **Voice persona** — Voice engine, voice selection, speaking style, and voice-specific instructions
- **Runtime mode** — Headless or dedicated
- **Container capability** (dedicated only) — Minimal or desktop
- **Storage** (dedicated only) — Persistent or ephemeral
- **Runtime lifecycle** (dedicated only) — Always on or sleep when idle
- **Model** — Which AI model to use (e.g., Claude Sonnet, Claude Opus)
- **Limits** — Safety caps like maximum tool calls per turn
- **Skills** — Add or remove skills from the agent's skill set. Each skill is a markdown file describing when and how to use it.
- **Sub-agents** — Add or remove sub-agents the agent can delegate to
- **Peer directory** — Other agents this agent can message directly or invite into group chats (see *Agent-to-agent messaging*)
- **MCP servers** — External integrations (see *External integrations*)
- **Team** — Which team the agent belongs to, if any (see *Teams*). Optional.
- **Channel overlays** — Per-channel prompt adjustments for this agent, optionally inheriting from org-level and team-level overlays (see *Channel overlays*)
- **Seed sessions** — Pre-created sessions for this agent (see *Sessions > Seed sessions*)
- **Scheduled tasks** — Cron-based schedules for this agent (see *Scheduling*). Each agent has its own task list, with optional per-task knowledge-scope overrides.
- **Knowledge policy** — How this agent reads from and writes to the knowledge system: per-subject write scope choices, plus optional elevated reach extensions for admin/internal agents (see *Knowledge policy*)

Agent definitions are org-scoped.

### Agent isolation

Each agent has its own persona, skills, sub-agents, and runtime. Agent A's skills don't bleed into Agent B. The Claude Agent SDK's lazy loading discovers only what belongs to that agent — skills and sub-agents aren't loaded into the system prompt up front, they're only read when the agent actually needs them. (See *Skills and sub-agents* below for how this works.)

### Where agent definitions live

Agent definitions — names, personas, skills, sub-agents, MCP configs, knowledge policies, everything — live in the Nexus database, not on any single machine's filesystem. The database is the source of truth for every agent in the org.

When an agent instance is running, Nexus materializes the agent's files into the folder layout the Claude Agent SDK expects (a `CLAUDE.md` at the agent's root, skills under `.claude/skills/`, sub-agents under `.claude/agents/`). For dedicated agents the materialization happens inside the container; for headless agents it's a dedicated folder on the Nexus server. Either way, the SDK walks real files and lazy-loads skills exactly as it would in any local Claude Code project — nothing is forced into the system prompt up front.

When an operator edits an agent in the Nexus UI, the change lands in the database. Running instances pick it up at their next session start — or immediately, if the operator hits an **apply now** action that refreshes the currently active sessions. For dedicated agents, the tool daemon rewrites the agent's files in place, so no container restart is needed for content changes. For headless, the server-side folder is refreshed just before the next session starts. The net experience is "edit, save, next conversation uses the new version," identical across self-hosted and SaaS, and without tying agent definitions to any one orchestrator node.

If an operator wants a tweaked version of an agent for just one purpose, the launch approach is to duplicate the agent definition. An in-place "fork" action is a planned follow-on (see *FUTURE_PRD.md F6*).

### Agent-to-agent messaging

Any running agent can send a message to another running agent and get a response. This is peer-to-peer communication — different from sub-agents (which are delegation within one agent's own context).

**The peer directory.** Each agent has a configured list of peers it's allowed to message — a small directory of named aliases (e.g., `@billing`, `@research`). Operators set up this directory when configuring the agent, similar to configuring MCP servers. Agents can only message peers that appear in their directory — no ambient discovery, no guessing at names.

Peers can be any other agents in the same organization; peer directories never cross organization boundaries.

**Sending a peer message.** An agent sends a message to a peer through its directory alias, with:

- **The message** — the question, request, or information being sent
- **A response expectation** — one of:
  - `answer` — substantive response expected
  - `acknowledgment` — brief confirmation is enough
  - `no_reply` — FYI only, nothing needed back

The receiving agent gets the message along with the full history of the exchange so far (the original request, prior messages, the round number) and decides how to respond. Responses in a peer exchange can produce text (what the sender sees), silent tool calls (the receiver does work without sending a reply), or both.

**Ending an exchange.** An exchange ends when an agent marks their reply with `done: true`. After that, no further messages can be sent in the same exchange — if an agent wants to continue the topic, they start a new exchange.

By default, either agent can end the exchange. For cases where the initiator wants tighter control, they can flag the exchange as *initiator-only-ends* on the first message. In that mode, only the initiator can set `done: true`; the receiver can still send `suggest_end: true` as a soft signal ("I think we've covered it") and the initiator decides whether to end.

**Preventing runaway loops.** Most exchanges terminate naturally through response expectations, exchange history visibility, and persona guidance to be concise. As a last-resort backstop, the system enforces a maximum message count per exchange — reaching it ends the exchange automatically with a logged warning. The backstop should rarely fire if the natural mechanisms are working.

**Example.** A receptionist agent receives a customer question about billing. It calls its `@billing` peer with `expect: answer`. The billing agent replies with the information and marks its response with `done: true` since it has nothing more to add. The receptionist relays the answer to the customer. Exchange complete.

### Agent group chats

Agents can participate in group conversations — not just one-on-one exchanges. A group chat is a **session with multiple agent participants**, and optionally with human participants (operators via the Nexus UI, or external humans via a connected channel). Group chats behave the same as other sessions for lifecycle, routing, and operator access.

Group chats support:
- Multiple agents in one conversation (research + writing + review, for example)
- Agents from anywhere in the same organization participating in the same chat (invited via their peer directory alias)
- Operators in the Nexus UI dropping in to participate directly
- External humans joining via a channel connected to a service with native group chats

**Where a group chat lives.** Group chats are top-level org-scoped objects — a single session record with a set of participant agents. Each group chat has a mandatory **designated agent** (see *Per-group configuration* below) whose instance serves as the chat's structural home: the session record lives on that instance, channel routing resolves to it, and the Nexus UI shows the chat primarily under that agent's session sidebar. The anchor role is purely plumbing — participating agents (including the designated agent) contribute on equal conversational footing, and the chat persists independently of any one participant's state.

**Creating a group chat.** Operators create group chats ad-hoc in the Nexus UI, or define them as seed sessions on an agent or as part of a team template. Agents can also create group chats and invite other agents from their peer directory, but only if they have Nexus's **"Group chat management" skill** installed on their agent definition (see *Participant management* below). Agents without the skill can participate normally in chats they're invited to — they just can't spawn new chats or change rosters from the agent side.

**Participant modes.** Each participant in a group chat is either:
- **Active** — can send messages into the chat (default for agents)
- **Observer** (read-only) — sees all messages, can take tool actions (write knowledge, trigger workflows, make API calls, etc.), but can't post in the chat. Useful for monitoring agents, analytics agents, or archival agents that shouldn't add chatter.

**Response arbitration modes.** Each group chat picks a mode that decides who responds when:

- **Pure addressing** — agents only respond when explicitly @mentioned. Humans and agents both use @mentions to direct messages. Best for multi-specialist collaboration or channel-connected groups (Slack-style) where humans mostly talk to each other and only invoke agents when needed.
- **Default agent** — one agent is the "driver." Messages without an @mention go to the default agent; messages with an @mention go to the addressed agent. Good for focused work chats where one agent owns the conversation.
- **Moderator** — one agent is the moderator. It receives every message, rarely speaks itself, and decides who responds (via @mentions). Other agents only respond when @mentioned (by the moderator or directly by a human). Good for complex orchestration.

Across all modes, **agents never respond to other agents' messages unless explicitly @mentioned** — this prevents runaway loops in multi-agent groups. The @mention system uses the same peer-directory aliases used for 1-on-1 peer messaging.

**Per-group configuration.** Each group chat carries:

- **Mode** — pure addressing, default agent, or moderator
- **Designated agent** — always mandatory. The designated agent serves two purposes at once: a **functional focal point** in arbitration (in default agent mode it's the default responder; in moderator mode it's the moderator; in pure addressing mode it's the nominal owner of the chat even though it has no special response behavior) and a **structural anchor** for routing, UI home, and permission scoping (see *Where a group chat lives* above and *Participant management* below).
- **Designated agent has manage-participants capability** — on/off. Requires the designated agent to have Nexus's "Group chat management" skill installed (if it doesn't, this toggle has no effect and only operators can manage participants). When both the skill and this toggle are on, the designated agent can add participants from its peer directory and remove participants. When the toggle is off, the capability is suppressed for this specific chat regardless of the skill — a per-chat off-switch for sensitive chats.
- **Require operator approval for agent-initiated participant changes** — on/off. Adds a confirmation step when the designated agent proposes a participant change.
- **Group chat prompt** — a short instruction set for how agents should behave in this specific chat (e.g., "Only respond when @mentioned; act silently during routine enrichment"). Applied at runtime alongside each agent's persona.

**Participant management.** Agent-initiated group-chat creation and participant changes (add or remove) are gated in three layers:

1. The acting agent must have Nexus's **"Group chat management" skill** installed on its agent definition. Operators decide which agents get this skill as part of the agent configuration; agents without it can't call the create-chat or manage-participants tools at all.
2. For edits to an existing chat, the acting agent must be the chat's *current designated agent*. Other participants in the chat — even ones that carry the skill on their own definition — can't manage that chat, because they're not the anchor for it.
3. The per-chat "Designated agent has manage-participants capability" toggle must be on for that specific chat.

Operators (with the appropriate Nexus permissions) can always create, edit, and manage group chats from the Nexus UI regardless of any skill state, subject to the N-key permission check in *Users & Permissions*.

**Changing the designated agent.** Operators can reassign the designated agent of an existing group chat to any other agent in the org that has the "Group chat management" skill installed. If the target agent isn't already a participant, the reassignment implicitly adds them as a participant first (re-running the same permission checks as any participant add). When the reassignment commits, the session record moves to the new designated agent's instance — the chat's structural home changes. Any channel whose routing currently resolves to the old designated agent's `(agent, instance, session name)` combo would otherwise stop reaching the chat; the reassignment UI surfaces the affected routing rules and offers to auto-update them to point at the new designated agent.

**Silent actions in group chats.** Any agent's response cycle in a group chat can produce text messages, silent tool calls, or both. The system never forces a text reply in a group chat — agents can read messages, take external actions, and stay silent when that's appropriate. (In 1-on-1 chats a text reply is required, and agent-to-agent peer exchanges follow their own termination rules above.) Operators get full visibility into tool calls through the session history; humans on the outside see only what agents choose to say.

**Connecting a channel to a group chat.** A group chat can be connected to an external group-chat service (Slack, Discord, Telegram group, WhatsApp group) via a Nexus channel. The channel's routing uses the same three-field shape as any other channel — the **agent** is the chat's designated agent, the **agent instance** is the instance hosting the chat, and the **session name** matches the group-chat seed session. There's no new routing primitive for group chats; the designated-agent anchor is the entry point. Messages from the external service flow into the group chat; agent responses flow back out through the channel. External humans see each other's messages natively on their side (they're already in a group together). See *Channels > Group chat bridging* for details on which channel types support this.

**External identity for agents in channel-connected group chats.** For launch, one external identity represents all the agents in a channel — e.g., one Slack bot posts all agent messages, and each message is prefixed with the speaking agent's name ("Billing: the invoice shows…") so external humans can tell who's talking. Giving each agent its own external identity (so it can be @mentioned natively on Slack) is a future enhancement described in *FUTURE_PRD.md*.

### External integrations (MCP servers)

Agents can connect to external services through MCP (Model Context Protocol) servers. This is how agents access GitHub, Slack, databases, or any custom API without building bespoke tools.

MCP servers are declared per agent configuration. When an agent starts, it connects to its configured MCP servers and gains access to whatever tools those servers expose.

Examples:
- A coding agent connected to a GitHub MCP server can create PRs, review code, and manage issues
- A data agent connected to a database MCP server can query and update records
- A support agent connected to a CRM MCP server can look up customer accounts

Operators configure MCP server connections from the agent settings in the Nexus UI — typically a server URL and optional authentication.

### Skills and sub-agents

At launch, Nexus is built entirely on the Claude Agent SDK for both headless and dedicated modes. Skills and sub-agents are Claude Agent SDK concepts:

- **Skills** — each skill is a folder containing a `SKILL.md` (the metadata and instructions describing when and how to use it) plus any supporting files the skill needs: helper scripts, reference documents, images, examples. Skills sit under the agent's `.claude/skills/` folder. They're discovered lazily — the `SKILL.md` headers are indexed but the body and supporting files are only read when the skill is actually invoked. Skills that include executable scripts run inside dedicated agents' containers; headless agents have no shell, so bundled scripts can be read as reference but can't execute — something to keep in mind when designing skills meant to work across both runtime modes.
- **Sub-agents** — defined under the agent's `.claude/agents/` folder. The agent can delegate work to a sub-agent as a tool call.

The agent's main system prompt comes from the `CLAUDE.md` file at the root of its folder. The SDK points at that folder as the agent's root and discovers skills and sub-agents as they're needed. This keeps the agent's startup context small — no matter how many skills or sub-agents an agent has, only the ones it actually invokes get loaded.

---

## Teams

### What is a team?

A team is an organizational grouping of agents that share knowledge, channel-overlay behavior, default outbound channels, and seed sessions. Think of a team as the "department" an agent belongs to — a sales team, a support team, a DevOps team — where all members share a slice of context and defaults.

Teams are org-scoped. Team membership is optional: an agent can belong to one team, or to none. A teamless agent works exactly the same as a team member — it just doesn't participate in any team-level inheritance. (At launch, an agent can belong to at most one team. Multi-team membership is a possible future enhancement.)

### What a team carries

- **Team-tier knowledge** — a middle layer of knowledge between organization-tier and agent-tier, shared across every member agent. See *Knowledge > Knowledge scopes*.
- **Team-level channel overlays** — per-channel prompt adjustments that apply to every agent in the team, cascading above agent-level and below org-level overlays. See *Channels > Channel overlays*.
- **Default outbound channels** — a per-channel-type default outbound channel for the team (e.g., "this team's default SMS is the sales Twilio line"). Agents in the team pick these up automatically; individual agents can override them on their own definition. See *Channels > Outbound messaging*.
- **Team write-policy default** (optional) — per-subject defaults for where member agents' knowledge writes land. Agents can override for specific subjects on their own knowledge policy. See *Knowledge > Knowledge policy*.
- **Seed sessions from the team template** — if the team was instantiated from a template, the template can include seed sessions that get wired to specific member agents when the team is created. See *Sessions > Seed sessions*.

Teams are **not** runtime boundaries — they don't share compute, containers, or execution in any way. Two agents on the same team run entirely independently. The team is purely an organizational and configuration scope.

### Team templates

A **team template** is a reusable blueprint for creating a team. A template captures:

- **Member agent definitions** — the agents that the template creates when instantiated
- **Team-level configuration** — team-tier knowledge starter pages, team-level channel overlays, default outbound channels, team write-policy defaults
- **Seed sessions** — pre-created sessions, each assigned to a specific agent in the template

Instantiating a template creates a live team with a fresh copy of the member agents and any seed sessions wired up. Operators can also build a team from scratch in the UI without using a template — start with no members, add agents one at a time.

### Managing teams

Operators create, edit, and delete teams from the Nexus UI:

- **Create a team** — either from scratch (empty membership, operator adds agents afterward) or from a team template (members and seed sessions wired up automatically)
- **Add or remove members** — any agent in the org can be added to a team or removed from one. Removing an agent from a team doesn't delete the agent; it just drops team membership.
- **Edit team-level settings** — team-tier knowledge pages, channel overlays, default outbound channels, team write-policy defaults
- **Delete a team** — when an operator deletes a team that still has member agents, they're shown a list of the members and asked what to do with each: delete the agent along with the team, or keep the agent as a teamless agent. The deletion confirms only once the operator has made a choice for every member.

Team management is gated by org-level permissions; see *Users & Permissions*.

---

## Knowledge

### The knowledge system

Nexus has a unified knowledge system — a wiki-style collection of markdown pages that agents read before responding and write to after learning something useful. This is the agent's long-term memory, and it's the backbone of how agents get smarter over time.

Knowledge lives on the Nexus server (not inside containers), backed by the database. This means knowledge survives container restarts, agent-definition changes, and team membership changes, and is accessible from any agent at any scope level. Agents access knowledge through tools that call the server — from their perspective, they just call `search_knowledge` or `write_knowledge`.

### Knowledge scopes

Knowledge is organized along two dimensions: **where it lives** (scope) and **who it's about** (subject).

**Scopes:**
- **Organization** — Accessible to every agent in the entire org
- **Team** — Specific to one team, accessible to every agent in that team. Only exists for agents that belong to a team.
- **Agent** — Specific to one agent

**Subjects:**
- **General** — Not about anyone specific. Policies, procedures, product docs, learned patterns.
- **Customer** — About a specific person (customer, user, contact — same thing). Their preferences, history, special needs.
- **Customer group** — About a group of people (VIP tier, enterprise customers, a team — same thing as "user group"). Shared traits, group-level policies, bulk preferences.

This creates a 9-scope matrix for agents in a team:

| | General | Customer | Customer Group |
|---|---|---|---|
| **Organization** | Company policies, brand guide, product docs | Org-wide profile of Customer X | VIP tier policies, enterprise group rules |
| **Team** | Team procedures and playbooks | This team's notes on Customer X | How this team handles the enterprise group |
| **Agent** | Agent-specific playbook | This agent's personal notes on Customer X | This agent's approach to VIP customers |

For teamless agents, the team tier simply doesn't exist — reads and writes cascade org ↔ agent directly.

When an agent in a team responds to Customer X (who is in the VIP group), it reads from all applicable layers — org general, org about X, org about VIPs, team general, team about X, team about VIPs, agent general, agent about X, agent about VIPs. More specific levels take priority when there's overlap.

### Knowledge format

Knowledge pages are markdown files with metadata (tags, titles, always-include flags). The system starts with simple index-based browsing and title/tag search. As knowledge bases grow large, vector search (RAG via pgvector) can be added so agents automatically find the most relevant pages without browsing.

### Knowledge policy

Each agent has a **knowledge policy** that controls how it reads from and writes to the knowledge system. The default policy is sensible for most agents — no configuration needed. Specialist or sensitive agents are tuned with a few clicks.

The policy lives on the agent definition. Teams can optionally carry a **team write-policy default** that applies to every member agent unless the agent explicitly overrides it for a subject. See *Writing knowledge* below.

#### Reading knowledge

By default, when an agent responds to a message, it reads from every page that applies to the current conversation:

- Org-tier pages — general; about the current contact; about groups the contact is in
- Team-tier pages from the agent's team (if the agent is in a team) — same three subjects
- The agent's own agent-tier pages — same three subjects

What it does **not** read by default:

- Customer or group pages keyed to other contacts (filtered out by the contact key)
- Other agents' agent-tier pages (each agent's tier is private to itself)
- Other teams' team-tier pages (each team is its own boundary)

This natural filtering means a billing agent talking to Client A automatically sees team-general policies and Client A's profile, but never sees Client B's notes or another agent's private notes — without any extra configuration.

#### Writing knowledge

When an agent writes a page, two things decide where it lands: the **subject** (what the page is about) and the **scope** (which tier it lives at).

- **Subject is picked by the agent.** It explicitly tags each write as `general`, `customer`, or `customer group` in the tool call. This is an honest judgment call visible in the audit trail — there's no hidden inference. If `customer`, the page is keyed to the session's attached contact. If `customer group`, the agent must specify which group the page is about.
- **Scope is determined by policy resolution.** For each subject, the scope is decided by the following cascade:

  1. If the agent has an explicit choice for that subject on its write policy → use it.
  2. Else if the agent belongs to a team and the team has a default for that subject → use the team default.
  3. Else use the system default: **team-tier** if the agent is in a team, **agent-tier** if it isn't.

  An agent's write policy can leave each subject as "inherit" (no explicit choice — falls through to team / system default) or set it explicitly to **org**, **team**, or **agent**. Team-tier can only be selected when the agent belongs to a team; for teamless agents the option is greyed out, and any team-tier selection auto-reverts to inherit when the agent leaves its team (with an operator notification).

  This gives teams a natural norm-setting mechanism — a team admin configures the team default once and every member follows it by default — while keeping individual agents free to override when they have a reason.

A sensitive agent handling confidential per-client information can set its customer-subject scope to **agent** so its learnings about each client stay private to itself. An agent meant to contribute company-wide knowledge can set general-subject scope to **org**.

If the agent tries to write a customer-subject page from a session with no attached contact (for example, a scheduled run with no contact target, or a shared-thread session that hasn't resolved a specific sender), the write fails clearly — the agent must use a different subject. Operator-direct sessions are not in this group, because every Nexus user is linked to a contact and the session is attached to it automatically (see *Contacts* and *The Nexus UI > Chat and voice*).

Operators can **promote** a page after the fact — re-scoping it (e.g., moving a sales agent's clever objection-handling note from the agent tier up to team or org so other agents benefit) or re-keying it (e.g., moving a page about Customer X who's a VIP up to the customer-group subject for the VIP tier). Promotion is the safety valve when an automatic write isn't quite right.

#### Elevated knowledge access

By default, agents stay within the current conversation's boundaries — current contact, this agent, this team. Some agents — typically internal admin or analyst agents not exposed to end users — need to reach beyond those boundaries. Elevated access is an opt-in setting that turns on one or more of three independent **reach extensions**:

- **Beyond this contact** — read and write customer / group pages for contacts other than the current one. The admin variant of a billing agent uses this to see and update its private notes across every client.
- **Beyond this agent** — read and write to other agents' agent-tier pages. An audit or oversight agent uses this to review what other agents have learned.
- **Beyond this team** — read and write to other teams' team-tier pages. An org-wide admin agent uses this to span the company.

Elevation extensions live on the agent definition only — they are never inherited from the team. Granting an agent cross-boundary reach is a sensitive capability, so it's always an explicit per-agent decision rather than a team-level default.

Each extension has a target selector — "all" within the org, or a specific list. They stack: an agent can have any combination turned on. Cross-org reach is never permitted; the organization boundary is hard.

When an extension is on, the agent can specify a target identifier (a specific contact, agent, or team) in its write tool call instead of defaulting to the current conversation's identifiers. Reads automatically include the broader set of cells in search results — no extra targeting needed. The write policy still controls which **scope tier** writes land at; elevation only unlocks **which contact / agent / team within that tier** the page is keyed to.

Two safeguards keep elevation away from end users:

- Granting elevated access is gated by an organization-level permission ("can grant elevated knowledge access"). Only super admins hold it by default.
- Any agent with elevated access carries a visible "Elevated access" marker in the agent list and on its definition page, so routing it to a public channel is obviously off-pattern.

### Context management

When an agent starts responding to a message, the system assembles the right context for that turn — what knowledge to include, what the current time is, any channel-specific adjustments, and relevant information about the person they're talking to.

**Knowledge preload** — At the start of a session, the system automatically loads relevant knowledge pages based on configurable rules:
- **Always-include pages** — Flagged in the knowledge page metadata. Loaded into every session regardless.
- **Conditional rules** — "Load the VIP playbook when a VIP customer starts a session." "Load the billing FAQ when the session is with the billing agent." Rules can match on customer, customer group, agent, or team.
- **First-turn only** — Preload happens at the start of a session, not on every message. This keeps subsequent turns fast.

**Channel overlay assembly** — At the start of a session, the applicable org-level, team-level, and agent-level channel overlays for the session's channel are combined into a single overlay block and locked in for the session's lifetime (see *Channel overlays* under *Channels*). Overlay edits don't affect currently-open sessions; the next new session picks up the updated text. Locking the assembled overlay at session start keeps the agent's prompt prefix stable across every turn, preserving cache hit rate.

**Contextual information passed every turn:**
- Current time
- Relevant knowledge from the agent's applicable scopes (org + team + agent, filtered by customer and customer group)
- Contact information (who the agent is talking to, their groups, their history)
- Any other context the system determines is relevant

Operators configure preload rules per agent from the Nexus UI. The system handles context assembly automatically each turn.

### What about Claude Code's native features?

Claude Code has built-in plans and to-do lists that it manages internally. These are session-level tools — the agent's scratch paper during a conversation. They're separate from the knowledge system because they're internal to the Claude Agent SDK and can't be accessed or managed by Nexus. Everything else (long-term memory, customer info, procedures, learnings) goes through the unified knowledge system.

---

## Contacts

### What is a contact?

A contact is a person — a real human who interacts with your agents. Each contact has a name, zero or more **identifiers** (the ways they can be reached), optional group memberships, per-channel-type outbound opt-out flags, an **internal/external flag** (`is_internal`) marking whether the person works for the organization running this Nexus instance, and open metadata.

The internal/external flag cleanly separates employees from external people (customers, prospects, partners). The default Contacts page view hides internal contacts so the customer-facing view stays uncluttered; a filter toggle brings them back in. Internal contacts participate in the same knowledge, session, and routing machinery as external ones — the flag is purely about who they are, not what they can do.

Every **Nexus user** (an account that logs into the Nexus UI) is linked to exactly one contact, via the Nexus user ID identifier — so when an operator interacts with an agent directly through the Nexus UI, the session knows who's talking the same way it would for any other contact. See *Contact creation* below.

Finer typology beyond internal/external — distinguishing customers from partner-org employees from customer-org employees — is a planned future enhancement (see *FUTURE_PRD.md F10*). At launch, internal vs. external is the only structural distinction; anything finer lives as free-form tags or groups.

Contacts live at the **organization level**. The same contact is visible across every agent in the org. (A future feature will allow restricting contact visibility to specific users or agents.)

### Identifiers

An identifier is a channel-specific address that resolves to a contact:

- **Phone** — used by SMS and voice channels
- **Email** — used by email channels
- **Telegram chat ID** — used by Telegram channels
- **WhatsApp number** — used by WhatsApp channels
- **Widget visitor ID** — a persistent browser cookie ID for unauthenticated web widget users
- **Site user ID** — a user ID from the host site that embeds a widget (for authenticated users of that site)
- **Nexus user ID** — the identifier that links a Nexus user account to their contact record. Every Nexus user has exactly one, and every operator-direct session uses it to attach the operator's contact to the session. Contacts with a Nexus user ID default to `is_internal = true` when auto-created during user provisioning, but the flag can be flipped manually (e.g., a contractor with Nexus access who doesn't work for the main org).

A contact can have any number of identifiers. When a message arrives through a channel, Nexus looks up the contact by the channel-specific identifier. If no match is found, a new contact is created (if the channel's auto-create policy allows).

Identifier uniqueness is scoped to the organization — no two contacts in the same org share an identifier, but different orgs can have separate contacts with the same phone number or email with no cross-org conflict.

### Web widget visitor flow

Web widgets are unique because they serve both authenticated and unauthenticated users of the host site (the third-party app that embeds the widget). The flow has three stages:

1. **Unauthenticated visitor** — on first visit, the widget assigns a persistent browser cookie ID. A new contact is created with a single *widget visitor* identifier. Subsequent visits from the same browser find the same contact.

2. **Authenticated visitor** — if the host site is passing its own user ID to the widget (via the embed code), that ID becomes a *site user* identifier. Nexus now resolves this person to the same contact across devices, not just across visits from one browser.

3. **Upgrade** — a visitor who was anonymous and later logs in on the host site now has both a cookie ID and a site user ID. Nexus adds the site user ID to the existing contact. The anonymous browsing history carries forward into the authenticated contact record.

### Contact groups

Contacts can belong to one or more groups. Groups are free-form named tags (e.g., "VIP," "Enterprise," "Beta testers") used by:

- **Routing rules** — route VIP group members to a senior agent
- **Knowledge scopes** — customer-group-level knowledge (policies for the VIP tier, notes on enterprise customers)

### Outbound opt-out flags

Each contact carries a small set of per-channel-type opt-out flags (one for SMS, one for email, one for WhatsApp, and so on) used by outbound messaging. When a flag is set, agents can't send outbound through that channel type to that contact — the `send_message` tool returns a clear error. Inbound from an opted-out contact still works normally; the flag only governs agent-initiated sends.

Flags get set automatically when a contact replies with a standard opt-out keyword (e.g., "STOP" on SMS or WhatsApp, unsubscribe-link clicks or "unsubscribe" replies on email). Operators can also toggle flags manually from the Contacts page — for legal requests, customer preferences, or cleanup after a mistaken send.

See *Outbound messaging* under *Channels* for how the flags interact with the send_message tool.

### Contact merging

A single human can unintentionally become two (or more) contacts — for example, if they call from a phone and later email from an address, and neither identifier was linked ahead of time. The **Merge Contacts** action fixes this:

- Operator selects two or more contacts and merges them into a primary
- All identifiers, sessions, conversation history, and group memberships transfer to the primary
- Customer-scoped knowledge is auto-merged where possible; when pages on the same topic have conflicting content, the operator is prompted to choose or combine
- Metadata conflicts (e.g., two different names) are resolved by the operator at merge time
- Merge is reversible within a short undo window

### Contact creation

Contacts are created:

- **Automatically when a message arrives** from an unknown sender through a channel configured to auto-create. The new contact gets the channel's identifier and `is_internal = false`.
- **Manually by an operator** via the Nexus UI's Contacts page. The operator sets the name, identifiers, groups, and internal/external flag.
- **Automatically when a Nexus user is created.** Every Nexus user account is linked to exactly one contact. When a super admin creates a new Nexus user, they choose one of two paths:
  - **Create a new contact** alongside the user (default for new hires). A fresh contact record is created with the user's name and `is_internal = true`, and the user's Nexus user ID is attached as an identifier.
  - **Link to an existing contact** — useful when someone already exists as an external contact (e.g., from a prior email exchange or customer relationship) and is now being onboarded as an operator. The admin selects the existing contact; the Nexus user ID identifier is added to it. The admin also decides at that moment whether to flip `is_internal` to true (they now work for the main org) or leave it as-is (e.g., a contractor from a partner org who gets Nexus access but isn't an employee).

---

## Channels

### What is a channel?

A channel is a way for people to reach your agents from outside of Nexus. Each channel connects a specific communication method to your agent system.

Channels are *always* external-facing — SMS, email, web widgets, phone calls, etc. The chat and voice panels inside the Nexus web UI are **not** channels. They are the operator's direct interface to a running agent instance, bypassing routing entirely. See *The Nexus UI* for how operator access works.

### Channel types

| Channel | How it works |
|---------|-------------|
| **Web Widget** | An embeddable chat + voice widget for websites and apps. Available as a drop-in script tag or a React SDK. See *Web Widget & SDK* below. |
| **SMS** | Text messages via Twilio. People text a phone number, your agent responds. |
| **Voice** | Phone calls via Twilio, Vapi, or browser. Real-time voice conversations. |
| **Email** | Incoming emails via Gmail/Google Pub/Sub trigger agent responses. Threaded replies continue the same session. |
| **Slack** | A Slack bot for direct messages and participation in Slack channels. |
| **Discord** | A Discord bot for direct messages and participation in Discord server channels. |
| **Telegram** | A Telegram bot that people can message 1-on-1 or invite into group chats. |
| **WhatsApp** | WhatsApp messages via Meta's Cloud API. Supports 1-on-1 and group messaging. |
| **API** | A REST API for programmatic access. Powers custom integrations and third-party apps. |

### Setting up a channel

From the Nexus UI, you create a channel by:

1. Picking the type (SMS, voice, web widget, etc.)
2. Entering credentials (Twilio account info, API keys, etc.)
3. Setting up routing (which agent should handle incoming messages)

Nexus automatically configures webhooks with the provider when possible (Twilio, Vapi, WhatsApp). For providers that require manual setup (like Gmail/Pub/Sub), the UI shows step-by-step instructions.

Creating, editing, and deleting channels are gated by a two-key permission check (organization-level plus agent-level on every agent the channel's routing touches). See *Users & Permissions*.

### Multiple channels, same type

You can have multiple channels of the same type. Three different Twilio phone numbers? Three SMS channels, each potentially routing to different agents. Two web widgets with different branding? Two web-widget channels. Each channel has its own credentials, routing rules, and webhook URL.

### Group chat bridging

Some channel types can be connected to a Nexus group chat session, bridging external humans into the group chat as participants. This is supported by channel types that natively have group conversations: **Slack** (channels), **Discord** (server channels), **Telegram** (groups), and **WhatsApp** (groups).

Bridging is done by configuring the channel's routing to a static session name that matches a group-chat seed session — the matched session is the group chat. External humans on the service see each other's messages natively (they're already in a group together); agents in the Nexus group chat see the external humans' messages as participants.

Channel types without native group support (SMS, email, voice, web widget, plain 1-on-1 Telegram or WhatsApp bot messaging, API) connect to individual sessions per contact or to shared inboxes via ordinary session-name templates — they don't bridge into group chats, because multiple independent senders don't share a group on those services.

### Web widget & SDK

The web widget channel has three layers, each building on the one below:

**JavaScript SDK** — A WebSocket client library that handles connection management, authentication, reconnection, message queuing, and the typed protocol for communicating with a Nexus channel. This is the foundation layer. Developers who want full control use this directly and build their own UI.

**React SDK** — React components and hooks built on the JavaScript SDK. Provides the communication layer plus optional UI components (chat panel, voice controls). Developers can use the provided components or build their own UI using the hooks. An optional session selector component works similarly to the session sidebar in the Nexus UI. The React SDK is the recommended path for React developers integrating Nexus into their apps.

**Script tag widget** — A pre-built, drop-in chat widget served by Nexus. Add a `<script>` tag to any HTML page and a floating chat bubble appears in the corner. Click to expand into a full chat panel with text and voice support. Configurable branding (colors, position, greeting text, title). No coding required beyond the embed snippet. Built on the React SDK internally.

All three connect to Nexus through a web-widget channel. The channel handles authentication (API keys, token exchange), routing, and session management. The widget/SDK handles the UI and communication protocol.

**Widget configuration from the Nexus UI:**
- Branding: colors, position (bottom-right/bottom-left), greeting text, title
- Capabilities: text-only, voice-only, or both
- Multi-session: whether visitors can see and switch between past sessions (optional session selector)
- API key management: generate, rotate, and revoke widget API keys
- Embed code: copy-paste snippet for script tag or programmatic init code for the SDK

### Outbound messaging

Agents can proactively reach out to contacts through channels — sending a text, emailing, messaging on WhatsApp, and so on. This isn't just responding to inbound; an agent can initiate contact. Typical use cases: a scheduled "daily brief" that emails the CEO every morning, a research agent that texts the requester when its work is done, or an agent asked to "message this person at this time."

**How the agent sends.** Agents call a `send_message` tool with:

- **Contact** — the specific person to reach, identified by their contact ID (the agent already knows the contact from the session context, or from a query it ran).
- **Channel** — the specific outbound channel to send through, identified by channel ID (not just a channel type). So the agent picks "the sales Twilio line" or "the support email inbox," not just "an SMS."
- **Message** — the text content.
- **Extras** (optional) — a free-form object for channel-specific details: attachments, email subject lines, message priority, and so on. Which fields are meaningful depends on the channel type.

**Default outbound channels.** Each team can designate a default outbound channel per channel type (e.g., "this team's default SMS is the sales Twilio line"), and individual agents can override those team defaults on their own agent definition. When an agent calls `send_message` without naming a specific channel, Nexus resolves the default by checking the agent's own override first, then the agent's team default, and finally fails with a clear "no default — please specify a channel" error if neither is set and the org has more than one channel of that type. Teamless agents rely on their own agent-level default or an explicit channel ID in the call.

**If the contact has no identifier for the chosen channel's type.** The tool doesn't silently pick a different channel. Instead, it returns a clear error to the agent listing the channel types this contact *does* have an identifier for, and the agent decides what to do — pick a different channel, skip the contact, or ask the operator for the missing info. No hidden fallback that could surprise an operator or reach a contact on a channel they didn't expect.

**Opt-out.** Each contact carries a per-channel-type opt-out flag. If a flag is set, `send_message` through that channel type is blocked with a clear error the agent can react to. Flags get set two ways:

- **Automatic** — if a contact replies "STOP," "UNSUBSCRIBE," or the equivalent on SMS, WhatsApp, or email, Nexus sets the opt-out flag for that channel type on that contact. The agent can still try other channels the contact hasn't opted out of.
- **Manual** — operators can toggle opt-out flags from the Contacts page in the Nexus UI (for legal requests, customer preference, cleanup after a mistaken send, etc.).

Affirmative consent (requiring an explicit opt-in before the first outbound) is a planned future enhancement described in *FUTURE_PRD.md*. At launch, outbound is allowed by default and opt-out is respected.

**How replies route back.** An outbound message lands in a session the same way an inbound message would, and any reply the contact sends continues that same session:

- Nexus resolves the outbound channel's routing for this contact — the same three-field resolution used for inbound (agent, agent instance name, session name). If an active session with the resolved name already exists, the outbound is **appended to it** — it just looks like another message in the ongoing thread, and any reply lands there too.
- If no session with the resolved name exists yet, a **new session is created** for the outbound, just as it would be for an inbound message. The contact's reply arrives and routes into that same session.
- If a session spans multiple channels (because two channels resolve to the same session name), the agent's replies always go back out through the channel the most recent inbound message came from — the same reply-through-originating-channel invariant that applies to inbound traffic.

Either way, the agent never accidentally splits a conversation across multiple sessions by reaching out proactively.

**Audit.** Every outbound message is recorded in the session's message stream alongside the agent's normal inbound replies — same visibility, same operator tools, same history. The session log is the audit trail; there's no separate "outbound log" to chase down. Like all conversation history, the audit trail is bounded by the org's retention window (see *Retention and deletion*).

**Rate limiting is not enforced at launch.** A runaway agent could in principle fire many outbound sends in a short window. Rate limits (per-org, per-agent, per-contact) are a planned future enhancement described in *FUTURE_PRD.md*. Until then, operators rely on the session history to notice outlier behavior and on the general agent-design safeguards (tool-call caps per turn, persona guidance) to keep sends reasonable.

### Channel overlays

Each channel type benefits from different communication styles. SMS needs short messages. Email needs proper formatting. Voice needs conversational language.

Channel overlays are prompt adjustments that modify how an agent responds based on the channel the message came through. For example:
- **SMS:** "Keep responses under 160 characters. No markdown formatting."
- **Voice:** "Speak naturally. Short sentences. No lists or formatting."
- **Email:** "Use proper email formatting. Include greeting and sign-off."

Overlays can be defined at three levels, mirroring the knowledge-scope hierarchy:
- **Organization-level** — Applies across every agent in the org. Good for company-wide voice norms (e.g., "always sign off with 'Cheers, Acme Team'" on email).
- **Team-level** — Applies to all agents in that team. Good for team-specific conventions (e.g., "Support team: apologetic tone on SMS"). Only exists for agents that belong to a team.
- **Agent-level** — Applies only to that specific agent. Good for per-agent customization (e.g., "Sales Rep is more persuasive on SMS").

By default, the three levels **compound** — an agent in a team receives org + team + agent overlays combined in that order on each channel; a teamless agent receives just org + agent. Each level has a **"self-contained" toggle**: when turned on, that level replaces everything inherited from above it instead of adding to it. This gives operators an escape hatch when a specific level needs to stand on its own.

Voice-channel overlays combine with the agent's voice persona the same way text overlays combine with the text persona — nothing special, just applied consistently alongside the persona.

**Session-start assembly.** Overlays are combined once when a session starts and locked in for the life of that session. This keeps the agent's prompt prefix stable across every turn (good for caching) and makes behavior easy to reason about — once a session is running, editing an overlay doesn't change what that session sees. Edits propagate on the next new session. Operators who want a change to take effect on an already-running session use an **"apply now"** action, which triggers a /carryover-style refresh so the new session picks up the updated overlay (same pattern as agent-definition edits).

**Preview.** From any overlay editor (org, team, or agent), operators can pick a channel and an agent and see exactly what the assembled overlay block will look like — with the contributing levels labeled — before any session uses it. This makes it easy to verify a change before rolling it out.

---

## Routing

### How messages get to agents

When someone sends a message through a channel, Nexus answers three questions to deliver it:

1. **Which agent** should respond? (Which agent definition, and therefore which kind of agent to spin up if an instance doesn't already exist.)
2. **Which agent instance** of that definition handles the message? (One shared instance? A separate instance per contact? A named instance like `staging` or `vip`?)
3. **Which session** (conversation thread) does the message belong to?

Each channel has a **default routing** that answers all three questions, plus zero or more **override rules** that can replace any of the answers for specific senders. See *Default routing* and *Override rules* below.

### Default routing

Each channel has a default routing configuration with three fields:

- **Agent** — the agent definition that should handle the message. Required. Tells Nexus what kind of agent to spin up if a named instance doesn't exist yet, and validates against the instance's agent type when one does.
- **Agent instance name** — the name of the agent instance to route to. If an instance with this name exists for the chosen agent, the message is routed into it; if not, Nexus creates a new instance with that name. Instance names are scoped per-agent-definition — two channels routing to `main` on different agents land on different instances. The UI warns operators at save time if a newly-configured channel would target an existing instance whose agent type doesn't match.
- **Session name** — the name of the session to route the message into. If a session with this name exists inside the target instance, the message lands in it; if not, Nexus creates a new session with that name. The session name is the key — two channels that resolve to the same session name share a session; two channels that resolve to different names have separate sessions.

### Per-contact instance toggle

The agent instance name field isn't raw text operators need to hand-write. The UI exposes it as a toggle:

- **Per-contact instance — OFF (default).** The channel uses one shared agent instance for all senders. Most chatbots, receptionists, and support setups use this.
- **Per-contact instance — ON.** Each contact gets their own dedicated agent instance — for dedicated agents, that's a separate container with its own filesystem and state; for headless agents, it's a separate running SDK session. The first time a contact messages, an instance is created for them; returning messages from the same contact reuse the same instance. Used when each contact genuinely needs isolation — e.g., a coding agent where every client has their own checked-out codebase, or a sandbox that shouldn't share state between users.

Under the hood, this toggle just extends the instance name with the contact's identifier — so one shared instance becomes one-per-contact when the toggle flips on. Operators don't interact with the template directly; they see the toggle. When the toggle is on, extra settings appear for the per-contact lifecycle (idle destroy, max concurrent, warm pool — see *Per-contact instance lifecycle*).

### Session name templates

Session names can reference dynamic values from the incoming message, so one channel configuration produces different sessions for different contacts, channels, or one-off tasks. The supported variables at launch:

- **`{contact_id}`** — the contact the message came from. The standard "one thread per contact" shape: template like `main-{contact_id}` produces a thread per contact.
- **`{channel_id}`** — the channel the message arrived on. Useful when an agent receives messages from multiple channels and each channel should stay in its own thread inside a session name pattern that happens to share prefixes.
- **`{new}`** — expands to a fresh unique value on every message. A template containing `{new}` always creates a new session (never resolves to an existing one). Use this for one-off task shapes where each message is an isolated run.

Templates can mix static text and variables: `main-{contact_id}`, `billing-{contact_id}`, `task-{new}`, `support-inbox`, `{channel_id}-{contact_id}`. A template with no variables (e.g., `support-inbox`) resolves to one shared session that all messages through the channel flow into — including messages from different contacts, who all appear in the same thread.

The UI presents session naming as friendly presets for the common cases (e.g., "Per contact" auto-fills `main-{contact_id}`; "One shared session" takes a plain name; "Fresh every message" uses `{new}`), with a "Custom" option for operators who want the template directly.

### Multiple channels routing into the same session

Two channels can route into the same session simply by resolving to the same session name — e.g., both SMS and email using the template `main-{contact_id}` means a contact's SMS and email messages land in one continuing thread. No separate "session group" concept is needed; the routing result itself is the grouping.

**Reply routing through the originating channel.** When a session receives messages from multiple channels, the agent's reply goes back out through the channel the most recent inbound message came from. The session tracks per-message channel provenance, so the agent's response path is always unambiguous — no configuration needed, and no accidental cross-channel sends.

### Examples of default routing

| Agent | Per-contact toggle | Session name template | What it does |
|---|---|---|---|
| Receptionist (headless) | off | `main-{contact_id}` | Company chatbot — one shared instance, one thread per contact. |
| Inbox Agent (headless) | off | `support-inbox` | Support inbox — one shared instance, all messages in one collaborative thread. |
| Answer Bot (headless) | off | `task-{new}` | Q&A bot — one shared instance, each question isolated. |
| Code Assistant (dedicated, persistent storage) | on | `main-{contact_id}` | Per-user coding sandbox — each client gets their own container with their own files; one continuing thread. |
| Code Assistant (dedicated, ephemeral storage) | on | `task-{new}` | Isolated task runner — each client gets their own container, each message a new task thread. |

### Override rules

Default routing handles the 95% case. For the rare case where specific senders on a channel should be routed differently, operators define **override rules**. Each rule matches on an incoming message and can replace any subset of the three routing fields.

Typical scenarios:

- **One phone number, two audiences.** A company SMS line where known customers route to a fulfillment agent, and unknown senders route to a sales agent.
- **One WhatsApp number, tiered customers.** Retainer customers route to their dedicated account manager; everyone else routes to the sales agent.
- **VIP treatment.** Callers in the VIP contact group route to a senior agent with its own dedicated instance; everyone else falls through to the channel's default.
- **Per-client dedicated instances.** Specific named contacts (e.g., "John from Acme Corp") route to a dedicated instance with a client-specific session namespace.

If the variation lives in the *channel itself* rather than in who's sending — a web widget on the sales page vs. one on the docs page, two different Twilio numbers for two different teams — that's two separate channels, not one channel with overrides.

Each rule has:

- **Scope** — where the rule applies:
  - **Channel** — this one channel only
  - **Channel list** — a specific set of channels (e.g., all three SMS lines, or SMS + WhatsApp + email)
  - **Organization** — every channel in the org
- **Match condition** — one of:
  - **Specific contact** — a named contact
  - **Contact group** — any contact in that group
  - **Unknown sender** — a message from a newly-created contact with no prior history
  - **Identifier pattern** — a simple wildcard match on the sender's raw identifier (e.g., `*@acme.com`, `+1-555-*`)
- **Overrides** — any subset of: agent, per-contact toggle / agent instance name, session name template. Unset fields inherit from whatever rule or default fills them in.
- **Priority** — a single integer, uniform across all scopes. Higher priority is evaluated first.

### How override rules resolve

All rules that apply to a channel — its own rules, any channel-list rule that includes it, and any org-wide rule — are merged into a single priority-ordered list. Each of the three routing dimensions (agent, agent instance name, session name) is resolved independently:

1. Walk rules from highest priority to lowest.
2. For each rule that matches the message, fill in any of the three dimensions the rule specifies that haven't already been filled by a higher-priority rule.
3. After all matching rules are processed, any dimension still unfilled takes its value from the channel's default routing.

So three rules can contribute independently: one sets the agent, another sets the agent instance name, a third sets the session name. Each dimension uses the highest-priority rule that specifies it.

**Tie-break order** — when two matching rules share the same priority number:
1. Channel-scoped rules beat channel-list rules, which beat org-wide rules ("more specific wins").
2. If still tied, the older rule (earliest creation date) wins.

The UI surfaces a non-blocking warning at save time when two rules in the same scope share a priority, prompting the operator to disambiguate.

**Routing preview.** From the routing editor, operators can pick a sample contact (and channel, if at org or list scope) and see exactly how the routing resolves — which rule set each dimension, and what the final agent / agent instance / session resolution looks like — before the configuration is used for real traffic.

### Per-contact instance lifecycle

When the per-contact instance toggle is on, the channel's agent instance name contains `{contact_id}` and a new instance is created every time an unseen contact first messages. Because this can proliferate — a busy channel can spin up hundreds of contact-keyed instances — per-contact-capable agents carry extra controls. These settings live on the agent definition, so any channel routing per-contact to this agent picks them up:

- **Idle destroy** — how long a contact-keyed instance can sit without activity before Nexus automatically destroys it. Options: a duration (e.g., 30 days of silence from that contact) or **never** (manual cleanup only). Default: 30 days.
- **Max concurrent instances** — a hard cap on how many contact-keyed instances can exist at once for this agent. When the cap is hit, the next message from a new contact fails clearly — the channel surfaces an "agent at capacity" error rather than silently picking a fallback or queueing indefinitely. Default: 100.
- **Warm pool size** — how many pre-started instances to keep on standby so a new contact's first message doesn't pay the container-startup latency. When a contact arrives, Nexus pulls an instance from the pool and replenishes in the background. Default: 0 (start on demand). Only meaningful for dedicated agents — headless agents have no container to pre-start.

These knobs are hidden from the agent-definition form until at least one channel routes per-contact to the agent; once on, the relevant settings appear and are editable.

**What operators see.** The agent dashboard shows every running instance in a single list, with filters for instance type (shared / per-contact) and by attached contact. Per-contact instances display the contact's name and last-activity time alongside the usual instance details, so operators can scan for idle or orphaned ones at a glance, and the filter set makes it easy to bulk-review or bulk-destroy.

**History on destroy.** Conversation history — every message, tool call, and agent action — is preserved in Postgres when an instance is destroyed; the sessions remain browsable in the Nexus UI in read-only form (no resume possible) until they fall out of the org's retention window or the contact is erased (see *Retention and deletion*). What's lost with the container is the filesystem state the agent accumulated (files it created, scratch notes, etc.). Operators should only turn on per-contact instance mode for dedicated agents when filesystem loss on auto-destroy is acceptable — otherwise set idle destroy to "never" and clean up manually.

### Editing routing

Changing a channel's default routing or override rules requires the "can edit routing rules" organization-level permission plus the "edit routing rules" agent-level permission on every agent the routing affects, both before and after the change. See *Users & Permissions* for the full two-key check.

### Examples

- "Anyone who texts the support number → default routing: Support Agent (headless, shared instance), session `main-{contact_id}`."
- "On the company SMS line, add an override: match = unknown sender, route to Sales Agent; known customers fall through to the default Fulfillment Agent."
- "On the WhatsApp number, add an override: match = contacts in the 'Retainer' group, route to each contact's dedicated account manager; everyone else falls through to the Sales Agent."
- "Org-wide rule: match = VIP contact group, agent = Senior Agent, agent instance name = `vip`. Every channel in the org picks this up unless a higher-priority rule overrides."
- "SMS + WhatsApp + email routing into the same Support Agent, all three with session template `main-{contact_id}` — a returning customer sees one continuing thread across all three channels."
- "John from Acme Corp (specific contact) → Code Assistant, agent instance name `acme`, session template `acme-{contact_id}`; everyone else falls through to the shared Code Assistant instance."

---

## Sessions

### What is a session?

A session is a conversation thread between one or more people and an agent. Sessions keep conversations organized and give agents continuity — the agent can recall what was discussed earlier in the same session.

A single agent instance can have many sessions running in parallel — one per customer, one shared inbox, many short-lived fresh ones — depending on what the channels routing to it are configured to do.

Most sessions are 1-on-1 between a contact and one agent, but sessions can also be **group chats** — multiple agent participants, optionally with human participants. Group chats behave the same as other sessions for lifecycle, routing, and operator access purposes (see *Agents > Agent group chats* for their specific configuration and behavior).

### Session lifecycle

A session stays active until it is refreshed. A refresh closes the current session and begins a new one in one of two styles:

- **New** — start fresh, no context carried over.
- **Carryover** — start fresh, but the agent receives a summary of the previous session (pending items, recent context, key learnings). Prevents total amnesia.

A refresh can be triggered by:

- **An operator**, via the New and Carryover buttons in the session sidebar, or by typing `/new` or `/carryover` in the session.
- **An end user**, on channels that support it (e.g., a "start over" action in the web widget, or a slash command where the channel permits).
- **A channel idle timeout** — if no activity for the configured duration, the session is automatically refreshed. Each channel configures its own duration and style. Example: a web widget might refresh after 8 hours of inactivity in Carryover style; an SMS channel might refresh at 3am daily in New style; an email channel might have no timeout at all.

Separately, agents maintain continuity automatically as conversations grow. When a session's context gets large enough to be costly, the system condenses older history while preserving recent turns — the conversation just keeps going. This is visible to operators as a subtle marker in the session view; it can optionally be surfaced to end users.

Agents also survive container restarts. For dedicated agents with persistent storage, the agent resumes the same underlying conversation state directly. For ephemeral storage — or in the rare case that persistent state is lost — the system reconstructs the agent's context from stored conversation history as faithfully as possible, so the conversation continues with minimal perceived disruption. Headless agents don't have container-level state, so they always reconstruct context from stored history.

### Seed sessions

Agents can define **seed sessions** — pre-created conversation threads that exist from the moment an agent instance starts. Useful for agents that should always have certain named sessions ready (like "Main," "Sales Inbox," "OpsLog").

Seed sessions live on the agent definition. Team templates can also carry seed sessions that get wired to specific member agents when a team is instantiated (see *Teams > Team templates*).

Each seed session can specify:

- **Name** — the session name. Channels whose resolved session name matches a seed's name route into that seed (this is how channels point at pre-created shared or group-chat sessions).
- **Participants** — either a single agent (implicitly the owning agent for an agent-level seed) for a regular session, or a list of participating agents plus group chat configuration for a group chat seed (see *Agents > Agent group chats*).
- **Pinned** (default: yes) — the session stays at the top of the session sidebar in the Nexus UI, even after it ends. Purely a display preference.
- **Auto-recreate** — if the session is refreshed or closed, whether a new seed session of the same name is automatically created

### How operators see sessions

The Nexus UI shows every session running on an agent instance — sessions created by channels (with their contacts and threads), sessions created from seed definitions, and sessions started directly by operators. Operators can switch between sessions, jump into any of them, and participate directly. This works the same for both dedicated and headless agents.

---

## Voice

### How voice works

Nexus supports real-time voice conversations. An agent can talk to someone on a phone call or through a browser-based voice chat in the web widget.

Voice is engine-agnostic. Nexus supports multiple voice providers and can switch between them:

- **OpenAI Realtime** — OpenAI's real-time voice API
- **Gemini Live** — Google's real-time voice API
- **Vapi** — Voice AI platform with phone number management

Each agent's voice persona specifies which engine and voice to use. If a better voice engine comes along tomorrow, you swap the engine in the agent config — everything else stays the same. This keeps Nexus future-proof as voice technology evolves rapidly.

### Caller identification

When someone calls, the voice agent knows who they are. The system looks up the caller's phone number (or widget visitor ID for browser voice) against the contacts database and passes the agent:

- The contact's name and profile
- Their group memberships (VIP, enterprise, etc.)
- Relevant knowledge from all applicable scopes — org-level knowledge about this customer, team-level (if the agent is in a team), agent-level
- Current time
- Any other contextual information configured for this agent

If the caller is unknown, the agent gets the raw phone number and a note that the caller is unidentified. It can still have a productive conversation and the system can create a contact record afterward.

### Voice tools

Voice agents have exactly one tool at launch: `delegate_task`. It hands work off to the agent's text backend, which has full access to skills, sub-agents, MCP integrations, and everything else the agent can do in text. The voice agent stays engaged with the caller while the text side works in the background; when the text side finishes, its result is spoken back by the voice agent on the call.

This one-tool-for-everything design is deliberate. Voice calls have tight latency and audio-format constraints that most tools aren't built for, and the text backend already has every capability the agent needs. So rather than giving the voice side direct access to tools, voice delegates to text.

Operators should write the agent's voice persona to instruct it to use `delegate_task` for anything it can't answer conversationally on the call — looking up an order, scheduling something, sending a follow-up email, checking the knowledge base, anything with real work behind it. The voice agent acknowledges the caller ("let me check on that"), delegates, and responds when the text side returns.

A richer voice tool story — voice-safe flags on MCP tools, platform-built voice tools beyond `delegate_task`, and operator-defined voice tools — is captured in FUTURE_PRD.md F12.

### Voice + text together

When someone is on a voice call, the agent can simultaneously work on tasks in text. For example, during a voice call, the caller asks "can you look into that bug?" — the voice agent delegates the task to the text agent, which works on it in its container or server-side runtime. The caller gets a voice update when it's done. The full conversation (voice transcripts + text work) is all visible in the Nexus UI.

---

## Scheduling

Agents can run on schedules, not just in response to messages. This makes agents proactive — they can check for updates, send daily summaries, monitor systems, and perform recurring tasks without anyone prompting them.

### Scheduled tasks

Scheduled tasks are a first-class entity in Nexus. A task can fire either an **agent run** (the named agent runs) or a **workflow** (a named automation workflow in the org's workflow engine runs — see *Automations*). Operators browse and manage scheduled tasks from the agent or workflow settings, and agents with the right tools can also create, edit, or cancel tasks by chat (see *Managing scheduled tasks*).

Each scheduled task has:

- **Cron expression** — When to run (e.g., "every weekday at 9am," "every hour," "first Monday of the month")
- **Timezone** — The schedule runs in the operator's configured timezone
- **Enabled/disabled** — Tasks can be paused without deleting them
- **What the task fires** — an agent run, or a workflow (see below)

### What the task fires

**Agent run.** The task is anchored to an agent. When it fires, the named agent runs in its shared instance. The task additionally carries:

- **Prompt** — What to tell the agent when the schedule fires (e.g., "Check for new PRs and summarize them," "Generate the daily sales report")
- **Output target** — Where the run happens and where any text output goes (see *Output target*)
- **Knowledge scope** — Optional override of the agent's default knowledge access for this task (see *Task-level knowledge scope*)

At launch, agent-run tasks can only be configured on agents that are routed shared (not per-contact). Scheduling on per-contact agents — which would need to pick which contact's instance to run on, or fan out across all active instances — is deferred (*FUTURE_PRD F13*).

**Workflow.** The task references a workflow in the org's workflow engine. When it fires, Nexus invokes that workflow; the workflow does whatever its own definition specifies — post to Slack, update a spreadsheet, call external APIs, or send a message into a Nexus API channel to trigger an agent. Workflow-firing tasks don't carry prompts, output targets, or knowledge-scope overrides — those concepts belong to agent runs. See *Automations* for how workflows are built and what they can do.

### Output target

The output target decides which session the run lives in. The session itself is where context accumulates across runs, so picking the target also picks the continuity model.

- **A specific session name.** The run lives *inside* that session, exactly as if a message had arrived there — yesterday's daily-summary run is in today's context. Session names accept the same template variables as channel routing (see *Routing > Session name templates*):
  - A static name like `daily-briefs` → one continuing session that accumulates context across every run.
  - `{new}` → a fresh session for every run; nothing carries over.
  - `daily-{date}` → one session per day; context carries within a day, fresh each day.
- **A specific channel.** The run routes through the channel's own session configuration, so it lands in whichever session that channel's template would resolve to for this contact-less run. Useful for tasks whose output should go out through an external channel (e.g., "post a daily PR summary to a Slack channel") — continuity semantics come from the channel's configuration.
- **No text output.** The run does its work silently; only the tool-call audit trail records what happened. The run still needs a session to live in for the audit trail, so it uses a default scheduled-run session for that agent.

Every run is logged in its session regardless of text output, so operators can always audit what the agent did. If the agent instance is asleep (dedicated agents with sleep-when-idle lifecycle), it's woken up first.

### Task-level knowledge scope

By default, a scheduled task runs with the same knowledge access the agent would have in any session — its normal knowledge policy applied with the run's session identity (see *Knowledge policy*).

A scheduled task can also carry a **task-level knowledge-scope override** that replaces the agent's default policy for this specific task. The override can independently change:

- **Read scope** — which knowledge cells this task's run can read (e.g., turning on "beyond this team" for a task that needs to pull stats across the org).
- **Write scope** — per subject, which tier the task's writes land at and which cells elevation lets it target.

Read and write are separate dimensions. A task can be granted write-only access to a scope (useful when the task just appends new pages or replaces a daily snapshot — e.g., a report-writer that updates a shared summary page it shouldn't browse) or read-only access to a scope. Write-without-read is meant for append-style or full-replace writes, not for editing existing pages blindly.

**Privilege bound.** The operator who creates or edits a task can only grant it knowledge access they themselves possess at that moment. A junior operator who doesn't have "beyond-this-team" read elevation can't configure a task that reaches across teams. Nexus checks this at save time, and again every time the task fires — if the owning operator's permissions later drop below what the task needs, the firing fails cleanly, the task is flagged in the UI, and an admin with sufficient permissions can re-save it (taking over ownership) or pick a new owner.

### Managing scheduled tasks

Operators have two ways to create, edit, and delete scheduled tasks:

- **Scheduled-task list in the UI.** Under the agent or workflow settings, operators see every task in scope: cron, what it fires, owner, last run time, result (success/error), next scheduled run. They can add, edit, enable/disable, delete, or manually fire a task from this list. Cron can be chosen via a human-readable helper (dropdown for common patterns) or entered as raw cron for advanced cases.
- **Through an agent with scheduling tools.** Agents can be equipped with `schedule_task`, `edit_scheduled_task`, and `cancel_scheduled_task` tools. An operator chatting with such an agent can say "move the daily brief to 8am" and the agent updates the task directly. The agent is acting as the operator who owns the chat session (every Nexus user is linked to a contact, so the operator's identity is always attached) — that operator's permissions bound what the agent can do.

**Edit permissions.** A scheduled task can be edited by its creator, or by any operator with the "can edit any scheduled task" organization-level permission. Any edit re-runs the knowledge-scope check above (for agent-run tasks) against whoever is editing (not the original creator), so ownership and permissions stay visible and auditable. For workflow-firing tasks, the editor must additionally have the "can edit workflows" permission.

### Triggering agents and workflows via API

Beyond cron schedules, agents and workflows can also be triggered programmatically from outside Nexus.

- **Agents** are triggered through the API channel. External systems (CI/CD pipelines, monitoring alerts, other applications, or workflows) send a message to an agent via the REST API. Triggered runs use the same output-target options as scheduled agent-run tasks (session with templates, channel, or no text output) and can carry the same task-level knowledge-scope override on their trigger configuration — bounded by the operator who configured the trigger, with the same save-time and firing-time checks.
- **Workflows** are triggered through their own webhook URLs. Every workflow in the org's workflow engine has a dedicated webhook URL exposed under the Nexus domain; an external HTTP call to that URL fires the workflow. Workflow webhooks are separate from API channels — channels route to agents with routing rules, contact resolution, and session semantics; workflow webhooks go directly to the workflow's step sequence. See *Automations*.

---

## Automations

Automation **workflows** are a first-class Nexus entity for non-agentic work — deterministic plumbing like "when a Slack message arrives in this channel, post the content to a Notion page" or "every weekday at 9am, fetch the daily sales numbers from the database and email them to the CEO." Where agents reason about context, workflows follow a fixed sequence of steps.

Nexus's workflow engine is built on **ActivePieces** (an open-source, MIT-licensed workflow automation engine). Operators build and edit workflows through the workflow builder embedded in the Nexus UI — a visual canvas for chaining triggers and actions across hundreds of supported services (Slack, Gmail, Notion, Postgres, HTTP, OpenAI, Stripe, CRMs, and so on).

Each organization has its own isolated workflow engine instance. One org's workflows and credentials are never visible to another org.

### What can trigger a workflow

- **A scheduled task** — see *Scheduling*. A task set to fire a workflow invokes it on its cron.
- **An external API call** — every workflow has its own dedicated webhook URL exposed under the Nexus domain. External systems (or other workflows) hit that URL to fire the workflow. Unlike API channels (which route to agents), workflow webhooks go directly to the workflow with no routing or contact-resolution layer.
- **An agent** — agents with the `trigger_workflow` tool can invoke any workflow their operator has permission to trigger. Useful for chat-driven automation ("send this summary to the team's Slack" → the agent calls the Slack-posting workflow).

### What a workflow can do

A workflow can call any service its step library supports, including calling back into Nexus — for example, a workflow can POST to an API channel to send a message to an agent, effectively starting an agent run as one of its steps. This lets workflows and agents chain together in both directions.

### Managing workflows

Operators have two ways to create and edit workflows:

- **The embedded workflow builder.** Under the organization's Automations page, operators open the workflow canvas, drag in triggers and actions, configure credentials (OAuth connections, API keys), and save. The workflows list shows each workflow's enabled state, last-run result, and trigger type.
- **Through an agent with workflow-editing tools.** Agents can be equipped with `create_workflow`, `edit_workflow`, and `delete_workflow` tools, plus an installable skill that teaches the agent how to express workflows. An operator chatting with such an agent can say "build me a workflow that sends me a Slack message whenever someone submits the contact form" and the agent drafts the workflow. The agent acts as the operator who owns the session, bounded by that operator's permissions.

**Edit permissions.** Creating, editing, or deleting workflows requires the "can edit workflows" organization-level permission. Without it, operators can view and trigger existing workflows but can't modify them.

### Relationship to API channels

Nexus has two distinct inbound webhook surfaces, and they serve different purposes:

- **API channels** deliver a message *to an agent*. They apply routing rules, attach a contact, pick an agent and session, and run the full agent flow. Use when the inbound event should be answered by an agent.
- **Workflow webhooks** fire a workflow. No routing, no agent, no session — just the workflow's step sequence. Use when the inbound event drives deterministic automation, which may or may not involve calling an agent along the way.

---

## Retention and deletion

Conversation history doesn't live forever. Nexus provides two mechanisms for removing stored data — one time-based and automatic, the other targeted at a specific person — so organizations can meet compliance requirements (GDPR right-to-erasure, CCPA, enterprise retention clauses) and keep storage costs in check.

### Retention window

Each organization sets a **retention window** — conversations whose last activity is older than this window are purged automatically on a nightly sweep. The super admin sets the window from the Settings page; changes take effect on the next sweep.

- **Default (SaaS):** 3 years.
- **Default (self-hosted):** never — self-hosted operators manage their own database and opt in to auto-purge if they want it.
- **Options:** a small set of common durations (30 days, 90 days, 6 months, 1 year, 2 years, 3 years, 5 years, never).

**What the retention window purges:** the full conversation container — every message, tool call, and agent action in the session, and the session row itself. Sessions whose instance has already been destroyed (and which now exist as read-only history, see *Routing > Per-contact instance lifecycle*) are purged the same way.

**What it does not touch:** knowledge pages at any scope (organization, team, agent, customer, customer-group). Knowledge is the curated, long-lived layer by design — it's meant to outlive individual conversations. If an org wants to prune knowledge on a schedule, operators do it manually. Aggregate analytics (token counts, message-volume metrics, cost totals) are also untouched — those are counters, not content.

Before saving a change to the retention window, the Settings page shows a preview: "This will purge approximately X conversations on the next nightly run." Shrinking the window from 3 years to 1 year is a meaningful action — the preview gives the super admin a chance to reconsider before confirming.

### Per-contact erasure

Independent of the retention window, operators with the **"Can erase contacts"** organization-level permission (super admins by default; grantable to others) can erase everything tied to a specific contact in one action. This is the right-to-be-forgotten path — a contact emails asking to be deleted, an operator handles the request without waiting for the retention window to expire.

From the Contacts page, the operator clicks **Erase all data for this contact** on a contact row, confirms via a prominent warning modal, and the system removes:

- The contact record itself — identifiers, group memberships, metadata, opt-out flags.
- Every 1-on-1 session that contact was attached to, in full (messages, tool calls, session row).
- The contact's individual messages within any group-chat sessions they participated in. The rest of the group chat — the other participants' messages and the session itself — is left intact, so the conversation stays readable for the other parties.
- Every per-contact agent instance keyed to that contact (see *Routing > Per-contact instance lifecycle*), including the instance's filesystem state (for dedicated agents).
- Every customer-subject knowledge page keyed to that contact.

**What survives a per-contact erasure:**

- Customer-group knowledge pages — the page is about the group, not the individual. Admins who want to scrub group pages for any references to the erased contact do so manually.
- Agent-tier, team-tier, and organization-tier general knowledge — not about the person.
- Aggregate analytics — counters with no PII.
- A minimal **erasure audit record** — who performed the erasure, when, which contact ID and name were erased. The contact's content is gone; the fact that the erasure happened is retained so the org can prove compliance later if asked.

Erasure is irreversible. There is no undo window — the warning modal is the only safety net.

### Self-service and portability

At launch, end users can't erase or export their own data through Nexus directly. They ask the org's operators (via support email, in-app message, etc.), and a permitted operator performs the erasure. Likewise, exporting a contact's data (GDPR right-to-portability) is a planned future enhancement — orgs that need portability at launch export from the database directly or handle it through their own support process.

### Where this is exposed in the UI

- **Settings page** — the retention-window dropdown and its preview (super-admin only).
- **Contacts page** — per-row "Erase all data for this contact" action, gated by the "Can erase contacts" permission.
- **Settings page (Audit subsection)** — searchable log of every erasure event (who, when, which contact). Erasure audit records persist independently of conversation history retention, since they're not themselves conversations.

See *The Nexus UI > Conversation history* for how retention reframes the history-browsing view.

---

## The Nexus UI

### What you see

The Nexus web app is the operator's interface. It's where you build, configure, and monitor everything.

### Dashboard
Overview of your agents, running agent instances, teams, and recent activity. Create new agents, start/stop existing instances, see which teams exist and who's in them.

### Agent view
When you open a running agent instance, you see:
- **Chat panel** — Talk to the agent directly. See all conversations happening on this instance.
- **Session sidebar** — Browse all active and past sessions. Pinned sessions stay at the top. Switch between conversations. Start new sessions or refresh existing ones.
- **Terminal** — Access the agent's container terminal (dedicated agents only)
- **File viewer** — Browse and edit files in the agent's container with a code editor, image viewer, and PDF viewer (dedicated agents only)
- **Browser view** — See the agent's browser if it has one (dedicated agents with desktop capability only)

### Teams view
Under the Teams page, operators see every team in the org, their member agents, team-tier knowledge, team-level channel overlays, default outbound channels, and any team templates. Creating, editing, and deleting teams all happen here.

### Group chats view
A dedicated **Group chats** page lists every group chat in the org at a glance — chat name, designated agent, participant list, arbitration mode, last activity — with filters by participant agent and by team. Operators can create a new group chat from here, click through to any chat, reassign its designated agent, or edit its participant list and settings. The group chat's primary home remains the designated agent's session sidebar (so operators working inside a single agent don't have to leave to see its chats); this page is the org-wide overview that the per-agent view can't provide.

### Chat and voice are operator access — not channels

The chat and voice panels in the Nexus UI are how operators interact with their agents directly. They are **not** channels. There's no routing, no session matching rules, no channel-side contact lookup — the operator is already authenticated, already knows which agent instance they're looking at, and can pick or create any session directly.

Operators see every session running on an agent instance, regardless of how the session was created:

- Sessions created by channels (with all their contacts and threads)
- Sessions created from seed definitions
- Sessions started by other operators

They can jump into any session, participate directly, or start a new one. This works the same way for dedicated agents (with their container's chat sessions) and for headless agents (with the agent's text and voice sessions). Voice works the same way — an operator can hit the voice button and speak directly to any session, bypassing all channel infrastructure.

**Operator-direct sessions attach the operator's contact.** Because every Nexus user is linked to a contact (see *Contacts*), a session that an operator starts directly in the UI is attached to *that operator's contact* — not to a nobody. Contact-aware machinery works the same as in any channel-routed session: the agent reads knowledge about the operator's contact, writes customer-subject knowledge keyed to them, and sees the operator's profile and groups. Because the contact is flagged internal, knowledge and audit trails stay visibly separate from external customer records — an internal contact's customer-subject pages don't mix into the customer-facing views. Operators who want to rehearse as an external customer should use a test contact via a test channel or a seed session with a specific contact attached, rather than direct chat as themselves.

### Channels & routing
Configure your channels, set up routing rules, manage webhooks. See which channels are active, webhook status, and who's talking to what. Set default outbound channels per team (with per-agent override).

### Contacts
See everyone who has interacted with your agents. View their history across channels and sessions. Manage contact information, group memberships, and role assignments.

### Knowledge
Browse and edit knowledge at all scope levels — organization, team, and agent. See what agents have learned about specific customers and groups. Manage knowledge pages, tags, and preload rules.

### Conversation history

Every message, tool call, and agent action is stored in Postgres for the duration of the org's retention window (see *Retention and deletion*). Operators can see the full history of any session within that window — not just text messages, but every tool the agent used, every file it read or edited, every search it performed.

History powers:
- **Session replay** — Browse past conversations in full detail
- **Session recovery** — If an agent instance restarts, the agent picks up where it left off using stored history
- **Carryover summaries** — When a session is refreshed with /carryover, the summary is composed from history
- **Analytics** — Token usage, activity tracking, cost estimation

Sessions older than the retention window are purged on the nightly sweep and disappear from the history view. Sessions tied to a contact who has been erased are removed immediately (per-contact erasure does not wait for the next sweep).

### Analytics

Simple monitoring dashboard showing:
- **Token usage** — Input, output, and cached tokens per session, agent, team, and org
- **Cost** — Estimated API costs based on token usage and provider pricing
- **Activity** — Message volume, active sessions, agent utilization over time
- **KV cache performance** — Two metrics:
  - **Cache hit rate** — What percentage of input tokens were served from cache (0-100%)
  - **Perfect cache rate** — What percentage of turns achieved optimal caching, where nothing in the previous context was modified and only new content was appended. This is the ideal scenario — the entire prompt prefix is a cache hit because it's completely stable. This metric shows how often the system achieves that.

### Settings
Organization settings, user management, permissions, API keys. Org-level channel overlays are managed here (see *Channel overlays* under *Channels*). The retention window and the erasure audit log also live here (see *Retention and deletion*).

---

## The End User Experience

The people who use your agents typically never see the Nexus UI. Their experience is through channels:

### Web widget user
They visit your website and see a chat bubble in the corner (or a chat panel built into the page by the site's developer using the React SDK). They click it, type a message, and get a response. If voice is enabled, they can click a phone icon to start a voice conversation right in the chat. The widget handles reconnection, session continuity, and can optionally support multiple sessions. It's branded to match the host site.

### Phone caller
They call a phone number. An AI agent answers with a greeting and has a natural voice conversation. The agent can delegate tasks to its text-based backend while keeping the caller engaged. When the task is done, the agent tells the caller the result.

### Text message sender
They text a phone number and get responses from the agent. Short, concise messages appropriate for SMS.

### Email sender
They send an email and get a thoughtful response from the agent. Replying to the email continues the same conversation thread naturally.

### Telegram / WhatsApp user
They message a bot (Telegram) or business number (WhatsApp) and have a conversation with the agent through their preferred messaging app.

### API consumer
A developer integrates with Nexus programmatically. They send messages via REST API and get responses. This powers custom integrations, third-party apps, and automated workflows. For chat-style integrations, the JavaScript SDK and React SDK (see *Web Widget & SDK*) provide a faster path than raw API calls.

---

## Key Architecture Decisions

These decisions shape how Nexus is built. They're included here for clarity on *why* things work the way they do.

1. **No custom agent loops.** Every provider's SDK brings its own agentic loop (Claude Agent SDK, OpenAI Agents SDK, Google ADK). Nexus builds the platform around the agent, not the agent itself. Building a good agent loop is incredibly difficult and outside the scope of this project.

2. **Claude is the launch target.** Nexus runs exclusively on the Claude Agent SDK at launch, for both dedicated and headless agents. It's built first and built well. Multi-provider support (OpenAI, Gemini, self-hosted) is a planned future direction — see *FUTURE_PRD.md F11*. The codebase is structured so adding a second provider is additive (new bridge, new enum value, not a schema restructure), but no multi-provider abstraction ships at launch.

3. **Knowledge lives on the server, not in containers.** Containers are ephemeral — they restart, get destroyed, get recreated. Knowledge must survive all of that. The knowledge system runs on the Nexus server backed by Postgres. Agents access it through tools that call the server.

4. **The tool daemon is for the UI, not the agent.** Every dedicated-agent container runs a tool daemon that powers the Nexus UI's file viewer, terminal, and browser panels. It's container infrastructure, not an agent tool provider. Headless agents don't have one — there's no container for it to live in.

5. **Channels are the production interface.** The Nexus UI is for building and operating. The real users of your agents interact through channels. This means channels, routing, and session management are first-class concerns, not afterthoughts.

6. **Voice is engine-agnostic.** Three voice engines today (OpenAI Realtime, Gemini Live, Vapi). The pluggable engine interface means new engines can be added without changing anything else. This keeps Nexus future-proof as voice AI evolves.

7. **Organizations are the isolation boundary.** Not per-user. An org can have many users with role-based permissions. Data never crosses org boundaries. The same architecture works for single-org self-hosted and multi-org SaaS.

8. **Agents collapse persona and runtime into one concept.** An agent is both a persona (personality, voice, skills) and a runtime (headless, or dedicated with its own container, storage, and lifecycle). There's no separate "workspace" entity — the agent's instance is what runs. This simplifies routing (three fields instead of four), eliminates overlay/standalone composition, and flattens the operator's mental model to "create agents, optionally group them into teams." A third runtime mode — **shared**, where multiple agents share one container for compute efficiency — is planned as a future enhancement (*FUTURE_PRD F14*).

9. **Teams are the optional organizational grouping.** Agents can belong to a team, which gives them a shared knowledge tier, shared channel-overlay level, shared default outbound channels, and (via team templates) shared seed-session blueprints. Teams are purely an organizational scope — they don't share runtime or compute. Teamless agents work identically; they just don't participate in team-level inheritance.

10. **Provider bridges are pluggable.** Adding a new AI provider for dedicated agents means building one bridge that implements the standard protocol. The rest of the system (routing, channels, knowledge, UI) is completely unaffected. Today: Claude. Future: OpenAI, Gemini, self-hosted, whatever comes next.

11. **Simple UI, full control.** Routing, channels, and session management offer maximum flexibility (three-field default routing, cascading override rules across channel / channel-list / org scopes, dynamic session-name templates, seed sessions). But the UI presents these as straightforward forms, dropdowns, and toggles — not configuration files or code.

12. **Contacts are org-scoped with identifier-based identity.** A contact is a person, and each person can have multiple identifiers (phone, email, Telegram chat ID, widget cookie, host-site user ID, Nexus user ID). The same contact is visible across every agent in the org. Identifier uniqueness is scoped to the org — no cross-org conflicts. When a single human unintentionally becomes two contacts (phoning from one number, emailing from a different address), operators can merge them explicitly, with conflicting knowledge flagged for review.

13. **Routing is three named targets with dynamic templates.** Each channel's default routing answers three questions — which agent, which agent instance, which session — and each of those values can be a static name or a template with variables (`{contact_id}`, `{channel_id}`, `{new}`). If the named target exists, the message goes there; if it doesn't, Nexus creates it. The per-contact toggle is a UI shortcut that extends the agent instance name with `{contact_id}`; two channels share a session simply by resolving to the same session name. Override rules sit on top of defaults and can replace any subset of the three dimensions for specific senders. Overrides cascade per-dimension across all applicable scopes (channel, channel list, org-wide) using a single uniform priority integer, so each routing dimension independently takes its value from the highest-priority matching rule that specifies it.

14. **Operator access is not a channel.** The Nexus UI's chat and voice panels give operators direct access to any session running on an agent instance, with no routing, no contact lookup, and no session-matching rules. Channels are exclusively for external users. This keeps the two interaction models clearly distinct — the operator's view and the end user's view.

15. **Workflows are a first-class Nexus entity, powered by an embedded open-source engine.** Nexus ships with ActivePieces (MIT-licensed) at launch as the workflow engine — one instance per org, embedded in the Nexus UI. Scheduled tasks can fire workflows; workflows can trigger agents via API channels; agents can author and edit workflows through tools plus a workflow-authoring skill. The engine choice is upgradeable — future versions may move to a polished commercial embed, a fork, or a custom-built engine (see *FUTURE_PRD*).

16. **Agent definitions live in Postgres, materialized to disk per instance.** Agent definitions — personas, skills, sub-agents, configurations — are database rows, not files on an orchestrator's local disk. At runtime Nexus writes the files the Claude Agent SDK expects into the container (for dedicated agents) or a dedicated server folder (for headless agents), so the SDK's native lazy-loading still works against real files. Edits land in the database and propagate to running instances at the next session start (or via an explicit "apply now" action) without needing a container restart. This keeps the orchestrator stateless across machine boundaries, clean for SaaS multi-tenancy, and consistent between self-hosted and SaaS deployments.
