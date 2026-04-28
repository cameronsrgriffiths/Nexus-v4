# Nexus V4

Platform for building, hosting, and operating AI agents across SMS, voice, email, web chat widget, Telegram, WhatsApp. Two deployment shapes: centralized SaaS and self-hosted open-source.

The full product spec started as `plan.md` (frozen baseline). PRDs (once written) live as GitHub issues; their local snapshots live under `.nexus/`. Implementation is broken into vertical-slice issues consumed by the orchestrator (`/orchestrate`).

## Communication style

Phrase everything — chat replies, PR descriptions, commit messages, issue comments, code comments — as simply and concisely as possible while staying precise. Plain words over jargon, short sentences over long ones, direct claims over hedged ones. Clarity beats thoroughness; an extra sentence that doesn't add information is worse than missing.

## Source-of-truth precedence

When two sources mention the same thing, trust them in this order (most authoritative first):

1. **The filed GitHub issue (PRD or implementation issue)** — what the team is actually building from.
2. **`.nexus/active/<name>/prd-draft.md`** or `.nexus/archive/<...>/prd.md` — the local snapshot. Same content as the GitHub issue, kept as a readable record.
3. **`.nexus/active/<name>/source.md`** — the original input that grilling refined.
4. **`plan.md`** — the founding spec, frozen for historical reference. Use as background; do **not** treat its details as authoritative once the founding PRD has been filed.

The most recent reasoning-trace entry in `.nexus/<...>/prd-context.md` wins over earlier entries within the same context file. The context file itself is an agent scratchpad — it is **not** part of the PRD and never used as a source of truth for implementation.

## How work flows here

1. **Refine** → `/grill-me on plan.md as prd` (or `/grill-me on feature <slug>`, etc.). Each session's questions and answers are written into `.nexus/active/<name>/prd-draft.md` (the durable artifact) and `.nexus/active/<name>/prd-context.md` (agent scratchpad). Sessions are resumable.
2. **File the PRD** → `/to-prd` polishes the draft and files it as a GitHub issue. The active folder moves to `.nexus/archive/<DATE>-<name>/`.
3. **Slice** → `/to-issues #<PRD issue>` files vertical-slice child issues. Each issue is a thin path through every layer (schema → API → UI → tests). The first slice establishes the end-to-end spine.
4. **Execute** → `/orchestrate` picks up to N ready issues (N = `maxParallel` in `.claude/orchestrator/config.json`, default 1), dispatches one worktree-isolated implementer subagent per issue in parallel, then dispatches a fresh-context reviewer subagent per implementer worktree to polish for clarity. Surfaces the resulting PR(s).
5. **Refinement after launch**: file an issue → `/grill-me on issue #N` → `/to-prd` (mini PRD as a child issue) → `/to-issues` if it spans multiple slices → `/orchestrate`.

## Rules for executor subagents

The orchestrator dispatches you in one of two roles:

- **Implementer** — given an issue and an isolated git worktree. Deliver that one issue end-to-end, push the branch, open a PR, then stop.
- **Reviewer** — given an implementer's existing worktree and a PR URL. Fresh context (no memory of how the implementer reasoned). Read the diff against `main`, look for clarity / consistency / maintainability improvements within the slice, edit and commit if you find them (prefix `RALPH: Review - `), or do nothing if it's already clean. Then stop. **Reviewers must not extend the slice** — only refine what's there.

### The vertical slice rule
The slice you're given cuts through every layer needed to deliver one user-visible behavior. Build it that way. Do **not** add layers, types, modules, or abstractions outside the slice — even if you think they'll be needed by a later issue. Later issues extend the spine; they don't pre-stub it.

### Tests
- Follow the `tdd` skill. Red → green → refactor, one test at a time. No bulk test-writing.
- Test behavior through public interfaces. Do **not** mock internal collaborators. Do **not** mock the database — use a real one (test container or local instance).
- Each slice ships with the integration tests that prove its end-to-end path.

### Git
- Your branch: `issue-N` where N is the issue number.
- One PR per issue. Final commit (or PR body) must contain `Closes #N` so merging closes the issue.
- Never `--no-verify`. If a hook fails, fix the cause.
- Never amend or force-push.
- Never delete branches, reset --hard, or clean -fd. The git-guardrails hook will block these anyway.

### When to stop and ask vs. just decide
- Decide: anything internal to the slice — naming, file layout, test structure, library choice within the existing stack.
- Stop and comment on the issue: scope ambiguity, a missing acceptance criterion, an unstated dependency on another issue, anything that would require editing files outside the slice's natural footprint.
- Never open extra issues. Surface scope concerns as a comment on the current issue and pause.

### Don't touch
- `plan.md` — historical baseline, frozen.
- `.nexus/` — PRD drafts, contexts, archived/abandoned PRDs. Owned by `/grill-me` and `/to-prd`, not by you.
- `CLAUDE.md`, `.claude/skills/orchestrate/`, `.claude/skills/grill-me/`, `.claude/skills/to-prd/`, `.claude/orchestrator/` — the orchestration system. Changes go through the user.
- `.claude/hooks/` — guardrails, owned by the project.

### Done means
- All acceptance criteria in the issue are checked.
- New tests cover the new behavior end-to-end and pass locally.
- Existing tests still pass.
- PR opened with `gh pr create`, body references `Closes #N`.
- You return to the orchestrator with the PR URL.
