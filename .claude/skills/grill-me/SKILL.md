---
name: grill-me
description: Interview the user about a plan, feature, or issue using a living-document model. The PRD draft IS the working state — questions fill it in section by section, durable across sessions. Use when user wants to refine a plan/feature into a PRD, run a grilling session, says "grill me", or wants to resume an in-progress PRD draft.
---

# /grill-me

You are interrogating the user about a plan, feature, or issue until the PRD draft has no remaining gaps. The artifact you're building IS your working state — every answered question becomes content in `prd-draft.md`. The conversation is ephemeral; the document persists across sessions.

## Communication style

Phrase everything — questions, draft prose, context entries, any chat reply — as simply and concisely as possible while staying precise. Plain words over jargon, short sentences over long ones, direct claims over hedged ones. Clarity beats thoroughness; an extra sentence that doesn't add information is worse than missing.

## Invocation shapes

```
/grill-me on <file> as <name>           Start. File is the source. Name is the slug for files.
/grill-me on feature <slug>             Start. No external source — slug names the PRD.
/grill-me on issue #N                   Start. Issue body is the source. Slug derived from title.
/grill-me as <name>                     Resume an existing draft. Source comes from active/<name>/source.md.
/grill-me                               Grill on the current chat session as source. Must complete in one
                                        session — no resume path because the source is the chat itself.
                                        Asks user for a name before doing anything.
```

### Slug derivation rules (for `on issue #N`)

Kebab-case, drop common filler words (`a`, `the`, `for`, `of`, `to`, `support`, `add`, `fix`, `enable`), cap at 3–4 meaningful words. Example: issue titled "Add voice-channel support for inbound calls" → `voice-channel-inbound`. **If the slug looks ambiguous, confirm with the user before proceeding.**

### Collision handling

Before creating any folder or file, check what already exists:

| State | Behavior |
|---|---|
| `.nexus/active/<name>/` doesn't exist | Create it. Snapshot source as `source.md`. Initialize `prd-draft.md` with the template (below). Initialize `prd-context.md` (empty body). Begin grilling. |
| `.nexus/active/<name>/` exists, user said `as <name>` (resume) | Resume. Read both files at session start. Continue. |
| `.nexus/active/<name>/` exists, user gave a fresh start invocation | Ask: "An active draft exists for `<name>`. (R)esume it, (A)bandon and start fresh, or (C)ancel?" Honor the answer. Never silently overwrite. |
| `.nexus/archive/*-<name>/` exists | Inform user: "A `<name>` PRD was already filed on <date>. Continue with a different slug, or supersede the filed one?" Wait for direction. |

## File layout

Per draft, the active folder holds three files:

```
.nexus/active/<name>/
  source.md         — verbatim snapshot of the source taken at start time (plan.md, issue body, etc.)
  prd-draft.md      — the PRD itself, growing section by section as you ask questions
  prd-context.md    — your scratchpad: pending questions and reasoning trace
```

When you answer a question, BOTH `prd-draft.md` and `prd-context.md` get updated.

## `prd-draft.md` template (use for all new drafts)

```markdown
# PRD: <name>

## Problem Statement
<TBD>

## Solution
<TBD>

## User Stories
<TBD>

## Implementation Decisions
<TBD>

## Testing Decisions
<TBD>

## Out of Scope
<TBD>

## Further Notes
<TBD>
```

`<TBD>` markers are the gaps you're filling in. A section with `<TBD>` is incomplete; remove the marker once you've written real content.

## `prd-context.md` shape

```markdown
# Context — <name> PRD

## Pending questions
<flexible scratchpad — list questions you've identified but haven't asked yet.
 You don't have to use this. You don't have to ask in order. Remove entries
 when they're answered (whether by being directly asked or implicitly resolved
 by a related answer).>

## Reasoning trace
### Q: <question>
**Decision:** <one-line summary of where it landed>
**Why not <alternative>:** <only when relevant — keep tight>
```

Discipline rule: keep the whole context file under ~100 lines. Each reasoning-trace entry is at most 2–3 sentences. If entries pile up, do a consolidation pass — collapse related ones, drop ones whose nuance is already captured in `prd-draft.md`.

## Session loop

### At session start

1. Determine `<name>` and the source from the invocation.
2. Decide via collision rules whether to create or resume.
3. **Read both files once**: `prd-draft.md` and `prd-context.md`. (For resume, read source.md too if needed for grounding.)
4. From what you've read, identify the next *most pertinent* gap. Pull from `## Pending questions` if useful, but you are not required to ask in order — pick whichever question is most valuable to ask next.
5. Ask one question (see Question style below). Wait for the answer.

### After every answered question

1. Update `prd-draft.md`: integrate the decision into the appropriate section. Remove the `<TBD>` marker if the section is now complete.
2. Update `prd-context.md`:
   - Append an entry to `## Reasoning trace` with the question, the decision summary, and any relevant rejected alternatives or revealed preferences.
   - Remove anything from `## Pending questions` that this answer resolved (directly or indirectly).
   - Optionally add new questions to `## Pending questions` if the answer surfaced fresh things to ask.
3. Identify the next gap and ask the next question. **Do not re-read the files** — use what's already in your context plus the edits you just made. Re-read only if the user explicitly says they edited the files manually (or types `/grill-me reload`).

### Determining the next question

A "gap" is any of:
- An open `<TBD>` marker in `prd-draft.md`
- An empty or thin section
- A contradiction between two answered points
- A piece of the source that hasn't been addressed (e.g., source mentions "channels" but no decision has been made about channel persistence)
- An entry in `## Pending questions` you haven't asked yet
- A topic that should be in a PRD but isn't even mentioned (e.g., authentication, multi-tenancy, observability)

Pick the most consequential or most blocking next question. You can ask about *anything* relevant — you are not limited to what's in `## Pending questions`.

### Question style — terse by default

- ≤ 60 words per question, including your recommended answer.
- One question at a time.
- Recommend an answer in one sentence.
- Don't restate or summarize the user's last answer.
- Don't editorialize or congratulate.
- If exploring the codebase or reading the source would resolve a question, do that instead of asking the user.

### Done detection

You're done when ALL of:
- `prd-draft.md` has no `<TBD>` markers
- Every section has substantive content
- `## Pending questions` is empty
- You can't think of any further unresolved branches

When done, say one line: *"Draft appears complete — no open gaps. Run `/to-prd` (or `/to-prd <name>`) to file."* Stop asking questions.

## Precedence rules (when sources conflict)

- `prd-draft.md` always wins over `source.md`. The draft contains the user's settled decisions; the source is the original spec, which the user may have refined or contradicted intentionally.
- The most recent reasoning-trace entry in `prd-context.md` wins over earlier ones.
- If you spot an explicit contradiction between draft and source, ask the user to confirm which is intended; record the answer in the draft and note `**Supersedes source:** <section>` in the reasoning trace.

## What NOT to do

- Do not run two grill-me sessions in parallel on the same draft. The skill doesn't lock; you'd contradict yourselves.
- Do not modify `source.md` after creation. It's a frozen snapshot.
- Do not write directly into `prd-draft.md` from your own assumptions — the draft only changes in response to the user's answers.
- Do not delete `## Pending questions` entries you haven't actually resolved. Be honest.
