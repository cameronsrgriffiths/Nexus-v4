# Orchestrator

Sequential, single-wave dispatcher that turns vertical-slice GitHub issues into PRs, one at a time. Built around `mattpocock/skills` for the planning chain (`grill-me`, `to-prd`, `to-issues`) and the `Agent` tool with worktree isolation for execution.

This is **v1**: one issue per `/orchestrate` invocation, no parallelism, no auto-merge. The user reviews and merges every PR. Parallelism and a polling loop are deliberate next steps once the loop is proven on a few issues.

---

## One-time setup (do this before the first run)

1. **Create a GitHub repo and push.** The orchestrator and the `to-prd` / `to-issues` / `qa` skills all use `gh issue create`, so a real GitHub repo is required.

   ```bash
   gh repo create nexus-v4 --private --source . --push
   ```

   (Use `--public` if you want it public. `--source .` means "this directory".)

2. **Confirm `gh` is authenticated.**

   ```bash
   gh auth status
   ```

3. **Sanity-check the guardrails hook.** With Claude Code open in this project, the PreToolUse hook in `.claude/settings.json` should refuse `git push`, `git reset --hard`, `git clean -f`, etc. Try one and watch it bounce.

---

## The initial run (plan.md → working software)

Open Claude Code in this project and run, in order:

1. **`/grill-me on plan.md as prd`** — starts (or resumes) the founding PRD draft at `.nexus/active/prd/`. The skill creates `source.md` (snapshot of plan.md), `prd-draft.md` (the working PRD, growing as you answer), and `prd-context.md` (agent scratchpad). Answer one question at a time. The draft updates after every answer, so you can close the session any time and resume tomorrow with `/grill-me as prd`. Done when the draft has no `<TBD>` markers and the agent says "Draft appears complete."

2. **`/to-prd`** (or `/to-prd prd`) — polishes `.nexus/active/prd/prd-draft.md`, files it as a GitHub issue, and moves the folder to `.nexus/archive/<DATE>-prd/` (where `prd-draft.md` becomes `prd.md`). If the polish pass finds a contradiction or genuine ambiguity, it asks you inline (≤3 small questions) or sends you back to `/grill-me as prd` for bigger issues.

3. **`/to-issues #<PRD issue number>`** — reads the filed PRD and breaks it into vertical-slice child issues. Each slice cuts through every layer end-to-end. The first slice should be the **thinnest end-to-end path** — one channel, one agent, one reply — so subsequent slices extend a working spine instead of integrating against vapor. Slices are tagged HITL or AFK; the orchestrator only dispatches AFK ones.

4. `/orchestrate` — picks up to **N** ready issues (N from `.claude/orchestrator/config.json` → `maxParallel`, default `1`), shows the queue to you, asks for confirmation, dispatches **N implementer subagents in parallel** (each in its own git worktree, TDD, integration tests, no internal mocks). When an implementer finishes, a **fresh-context reviewer subagent** is dispatched against that worktree to polish for clarity (mirrors sandcastle's review-prompt pattern: same worktree, no implementer reasoning carried over, polish-only commits prefixed `RALPH: Review - `, no scope expansion). The reviewer can also no-op if the code is already clean.

5. **Review the PR(s).** Merge each one (or send it back with comments — the issue stays open until merge).

6. `/orchestrate` again. Repeat until the queue is empty.

To run a bigger batch ad-hoc: `/orchestrate 4`. To make a bigger batch the default: edit `maxParallel` in `.claude/orchestrator/config.json`.

If `/orchestrate` says nothing is ready, run `bash .claude/orchestrator/next-ready.sh --explain` to see which issues are blocked by what.

---

## Post-launch refinement (same loop, smaller inputs)

For any change request after the initial build:

1. **File an issue describing the change** — either by hand, or via `/qa` if it's bug-shaped. Stays small and user-facing.

2. **`/grill-me on issue #N`** — derives a kebab-case slug from the issue title, creates `.nexus/active/<slug>/`, snapshots the issue body as `source.md`, and starts grilling. Same loop as the founding PRD, just smaller in scope.

3. **`/to-prd <slug>`** — polishes the feature draft, files it as its own GitHub issue (titled `PRD: <slug>`), archives the local folder.

4. **`/to-issues #<feature PRD issue>`** if the change spans multiple slices; otherwise the originating issue itself can serve as the slice.

5. **`/orchestrate`** picks it up like anything else. Same dispatcher, same executor rules.

The orchestrator doesn't care whether an issue came from the initial build or a refinement request — they're both just rows in the queue. Your `.nexus/archive/` folder accrues a clean design-history record over time: one folder per PRD that was ever filed.

---

## What "ready" means (the dependency contract)

`/orchestrate` consults `next-ready.sh`, which considers an issue ready iff:

- It is open
- It is **not** labeled `hitl` (human-in-the-loop slices wait for you)
- No open PR currently links to it (via `Closes #N` / `Fixes #N` / `Resolves #N` in PR bodies)
- Every issue listed under "Blocked by" in the body is **closed**

The "Blocked by" format is whatever `to-issues` emits — the script greps for `blocked by` lines case-insensitively and pulls every `#N` reference off them. So `Blocked by #12, #14` and a bullet list both work.

---

## Files in this system

```
plan.md                                    # Frozen baseline. Source for the founding PRD.
CLAUDE.md                                  # Executor agent rules. Read by every subagent.
.nexus/                                    # PRD lifecycle artifacts.
  active/<name>/                           # In-progress PRD draft.
    source.md                              #   Snapshot of the source taken at start.
    prd-draft.md                           #   The PRD itself, growing as you grill.
    prd-context.md                         #   Agent scratchpad (pending Qs, reasoning trace).
  archive/<DATE>-<name>/                   # Filed PRDs (one folder per PRD that was filed).
    source.md, prd.md, prd-context.md      #   Same shape as active, prd-draft renamed to prd.
  abandoned/<DATE>-<name>/                 # Drafts the user reset (kept, not deleted).
.claude/
  settings.json                            # Wires the git-guardrails PreToolUse hook.
  hooks/block-dangerous-git.sh             # Blocks force-push, push-to-main, reset --hard, etc.
                                           #   Allows plain `git push` so agents can publish
                                           #   feature branches and open PRs.
  orchestrator/
    README.md                              # This file.
    config.json                            # { "maxParallel": N } — orchestrator concurrency cap.
    next-ready.sh                          # Dependency-resolver. Returns up to --count issues.
  skills/                                  # Skill files (some from mattpocock, some local).
    grill-me/                              # PRD-as-living-document interview loop. (Forked locally.)
    to-prd/                                # Polish active draft + file as GitHub issue + archive. (Forked locally.)
    to-issues/                             # PRD → vertical-slice issues with deps.
    tdd/                                   # Red/green/refactor; integration over mocks.
    qa/                                    # Conversational bug filing.
    git-guardrails-claude-code/            # Source of the hook script.
    orchestrate/                           # /orchestrate slash command (this project).
```

---

## What v1 has and what it deliberately doesn't (yet)

**v1 ships with:**
- Parallel-capable architecture, shipped at `maxParallel: 1`. Bumping it requires zero code changes — just edit `config.json` (or pass `/orchestrate N`).
- Reviewer pass after every implementer (fresh context, same worktree, polish-only). Mirrors sandcastle's review pattern.
- Calibrated git-guardrails hook (allows feature-branch pushes, blocks force-push and pushes-to-main).
- Vertical-slice rule baked into both the implementer and reviewer briefs.

**Add when ready:**
- **No auto-loop.** The user is the merge gate by design — `/orchestrate` runs one batch per invocation. Once you trust it, add `/loop /orchestrate 5m` (the loop skill is built into Claude Code).
- **No merge train.** With sequential merges (you reviewing each PR before the next batch dispatches), you don't need one. Once you push `maxParallel` past ~3, you may want a small process that merges PRs in dependency order so parallel branches don't collide.
- **No CI-failure handling.** v1 stops at "PR opened." If CI fails, you handle it. A future executor wrapper can re-dispatch on red CI.
- **Sensible parallelism cap.** Practical sweet spot is ~4–8. Beyond that, merge conflicts and review attention cost more than the parallelism saves. The `next-ready.sh` script doesn't enforce a cap — that's on you when you edit `maxParallel`.
