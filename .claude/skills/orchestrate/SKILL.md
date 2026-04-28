---
name: orchestrate
description: Pick up to N ready vertical-slice issues (no unmet Blocked-by deps, not labeled hitl, no open PR), dispatch worktree-isolated implementer subagents in parallel, then dispatch a fresh-context reviewer subagent against each implementer's worktree. Use when user wants to advance the implementation queue, says "orchestrate", or wants to run the next batch of issues.
---

# /orchestrate

Parallel-capable, reviewer-paired dispatcher. Each invocation: pick N issues, run N implementers in parallel, run N reviewers in parallel after they land. v1 ships at N=1 (set in config.json), but the architecture supports any N. To increase parallelism you change one number — no skill rewrite required.

## Argument

- No arg: read `maxParallel` from `.claude/orchestrator/config.json` (defaults to 1).
- Numeric arg (e.g. `/orchestrate 3`): override the config for this invocation.

## Process

### 1. Resolve N

```bash
if [ -n "$ARG" ]; then N="$ARG"; else N=$(jq -r '.maxParallel // 1' .claude/orchestrator/config.json); fi
```

### 2. Find up to N ready issues

```bash
.claude/orchestrator/next-ready.sh --count "$N"
```

- Exit code 0: stdout has 1..N issue numbers, one per line. Read into an array.
- Exit code 1: nothing ready. Re-run with `--explain`, surface the rundown to the user (which issues are blocked, by what; which are HITL waiting for them). Stop.

### 3. Fetch each issue and present the queue

For each picked number, run `gh issue view <N> --json number,title,body,url`. Show the user a compact summary:

```
Queue (N issues):
  #12 — Add SMS channel adapter (vertical slice 3)
  #13 — Persist contact records on inbound SMS (vertical slice 4)
  ...
```

Then ask: **"Dispatch implementers for these N issues? (y/n)"**

If declined, stop. Don't auto-pick a different set.

### 4. Dispatch implementers — all in one message

This is the parallelism hinge. Issue **all N `Agent` tool calls in a single response message**. The harness runs them concurrently. Each call:

- `subagent_type`: `general-purpose`
- `isolation`: `"worktree"` — gives this implementer its own checkout
- `description`: `"Implement issue #<N>"`
- `prompt`: the implementer brief (template below, with `{{...}}` filled in)

**Implementer brief:**

```
You are an implementer subagent dispatched by /orchestrate on the Nexus V4 project.
You have your own git worktree (you are the only one writing to it) and your own branch.

## Your assignment

GitHub issue #{{NUM}}: {{TITLE}}
URL: {{URL}}

{{ISSUE_BODY_VERBATIM}}

## How to work

1. Read CLAUDE.md at the repo root before starting. Its rules are binding:
     - Vertical-slice rule — deliver ONLY this issue's slice end-to-end.
     - Use the `tdd` skill: red → green → refactor, ONE test at a time.
     - Integration tests over mocks. Do not mock internal collaborators or the database.
     - No --no-verify, no force-push, no amend. The git-guardrails hook will block these.

2. Implement the slice in your worktree. Commit freely.

3. When every acceptance criterion in the issue is satisfied AND tests pass:
     - Push the branch: `git push -u origin <branch>`
     - Open a PR: `gh pr create`. The PR body MUST contain `Closes #{{NUM}}`
       so merging closes the issue.

## Stop and surface (do NOT guess) when

You hit scope ambiguity, a missing acceptance criterion, an unstated dependency on
another issue, or anything that would require editing files outside the slice's
natural footprint:
  - Comment on the issue: `gh issue comment {{NUM}} -b "..."`.
  - Do NOT open the PR.
  - Return to the orchestrator describing what blocked you.

Do not open extra issues. Do not edit plan.md, CLAUDE.md, or anything under .claude/.

## Final reply (REQUIRED format — orchestrator parses this)

When you're done, your final reply MUST be exactly this format and nothing else:

  STATUS: ok|blocked
  ISSUE: {{NUM}}
  WORKTREE: <absolute path to your worktree>
  BRANCH: <branch name>
  PR: <PR URL, or "none" if blocked>
  SUMMARY: <one sentence>
```

### 5. Wait for implementers, collect results

The harness blocks until all N implementer Agent calls return. Parse each return for the `STATUS:`, `WORKTREE:`, `BRANCH:`, `PR:`, `SUMMARY:` lines.

- For implementers that returned `STATUS: blocked`: skip the reviewer pass for them. Note the blocker for the user.
- For implementers that returned `STATUS: ok`: queue them for the reviewer pass.

### 6. Dispatch reviewers — also in one message

For every `STATUS: ok` implementer, issue an `Agent` call. Again **all in a single message** for parallelism. Each call:

- `subagent_type`: `general-purpose`
- **No `isolation`** — the reviewer reuses the implementer's existing worktree.
- `description`: `"Review issue #<N>"`
- `prompt`: the reviewer brief (template below)

**Reviewer brief (mirrors sandcastle's review-prompt.md — fresh context, same worktree, polish-only commits):**

```
You are a code-review subagent dispatched by /orchestrate on the Nexus V4 project.
You have NO memory of how the implementer arrived at this code — that is by design.
Evaluate the artifact, not the reasoning.

## Your assignment

Review the implementer's branch for issue #{{NUM}}: {{TITLE}}
Worktree: {{WORKTREE}}
Branch:   {{BRANCH}}
PR:       {{PR_URL}}

## Setup

cd into the worktree before doing anything:
  `cd {{WORKTREE}}`

Read these for context:
  `git log -n 10 --format="%H%n%ad%n%B---" --date=short`
  `gh issue view {{NUM}}`
  `git diff main..HEAD`
  CLAUDE.md at repo root (rules are binding for you too)

## What to look for

You are an expert code reviewer focused on enhancing clarity, consistency, and
maintainability while preserving exact functionality.

Look for opportunities to:
  - Reduce unnecessary complexity and nesting
  - Eliminate redundant code and abstractions
  - Improve readability through clear variable and function names
  - Consolidate related logic
  - Remove comments that describe obvious code
  - Avoid nested ternary operators — prefer if/else chains
  - Choose clarity over brevity

Avoid over-simplification that:
  - Reduces clarity or maintainability
  - Creates clever solutions that are hard to understand
  - Combines unrelated concerns
  - Removes helpful abstractions
  - Makes code harder to debug or extend

Apply CLAUDE.md and the project's testing rules. The vertical-slice rule applies to
you too — do NOT add functionality outside the slice the implementer delivered.

Preserve functionality. Never change WHAT the code does — only HOW.

## Execution

If you find improvements:
  1. Edit files directly in this worktree.
  2. Run the project's test/typecheck commands and confirm they still pass.
  3. Commit with a message starting with `RALPH: Review - <one-line summary>`.
  4. Push: `git push` (the existing branch already tracks origin).

If the code is already clean: do nothing. Make no commit.

## Final reply (REQUIRED format — orchestrator parses this)

  STATUS: ok
  ISSUE: {{NUM}}
  REVIEW: clean|polished
  COMMIT: <sha if you committed, "none" otherwise>
  SUMMARY: <one sentence>
```

### 7. Report back to the user

Aggregate everything into one summary message:

```
Orchestration run complete. N issues processed.

✓ #12 — implemented + clean review     →  PR https://...
✓ #13 — implemented + polished by reviewer (RALPH: Review - extracted helper)  →  PR https://...
✗ #14 — blocked: <reason from implementer>  →  see issue comment
```

Tell the user: "Review and merge the PRs, then run `/orchestrate` again."

Stop. Do not auto-loop. Sequential batches by user invocation is by design — the user is the merge gate.

## When to use --explain manually

If `/orchestrate` keeps returning "nothing ready", run `bash .claude/orchestrator/next-ready.sh --explain` directly to see the full dependency state.
