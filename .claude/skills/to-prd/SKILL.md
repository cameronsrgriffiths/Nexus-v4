---
name: to-prd
description: File a completed PRD draft as a GitHub issue. Reads .nexus/active/<name>/prd-draft.md, polishes it, files it as a GitHub issue, then archives the local folder. Use when user has finished a /grill-me session and wants to file the PRD, or says "to PRD" / "file the PRD".
---

# /to-prd

Take a completed (or near-completed) PRD draft and file it as a GitHub issue. The draft was built incrementally during `/grill-me` sessions — your job is to polish it, file it, and archive the source folder.

**You do NOT interview the user from scratch.** The draft is the synthesis. You only ask the user a question if you find an actual ambiguity during the polish pass.

## Invocation shapes

```
/to-prd                Pick the draft. If exactly one exists in .nexus/active/, use it.
                       If multiple, list them and ask which.
                       If none, say so and stop.
/to-prd <name>         File .nexus/active/<name>/prd-draft.md.
```

## Process

### 1. Pick the draft

```bash
ls .nexus/active/
```

- 0 entries → "No active drafts. Run `/grill-me` first." Stop.
- 1 entry → use it.
- 2+ entries → list them with a one-line description (read the first non-template line of each `prd-draft.md`), ask the user which to file.

### 2. Read the draft

Read `.nexus/active/<name>/prd-draft.md`.

**Do NOT read `prd-context.md`.** The context file is the agent's scratchpad, not part of the PRD. The draft already incorporates every decision worth filing.

### 3. Validate completeness

Scan the draft for:
- `<TBD>` markers — any remaining means the draft isn't done.
- Empty sections.
- Sections that are obviously thin (one sentence where a paragraph belongs).

If the draft isn't complete:
- Tell the user which sections are gaps.
- Suggest: "Resume with `/grill-me as <name>` and address these. Then re-run `/to-prd`."
- Stop. Do not file.

### 4. Polish pass

The polish pass tightens the draft for readability and consistency. Edit the draft in place. Specifically:

- **Tighten language**: cut wordiness, remove repetition, prefer clear short sentences.
- **Dedupe**: if two sections say the same thing, consolidate.
- **Consistency**: harmonize terminology across sections (e.g., "agent" vs "bot" — pick one).
- **Sanity-check user stories**: each story should be in the form *"As an <actor>, I want <feature>, so that <benefit>"*, with a concrete actor (not "user").
- **No code, no file paths, no line numbers**: PRDs are durable; specifics rot. Express things in domain terms.
- **Out of Scope sanity**: if anything mentioned earlier in the draft was decided as "later" or "not now," it should be reflected here.

### 5. Ambiguity handling

If during polish you find a contradiction or a genuine ambiguity:

- **≤3 small clarifying questions**: ask the user inline, apply the answers to the draft, continue polishing.
- **More than 3, or anything systemic**: stop the polish pass, list the issues, and tell the user: *"This needs more grilling. Resume with `/grill-me as <name>` and address: …"*. Do NOT file.

A "small clarifying question" is something like "Section 3 says agents are stateless; section 7 implies they have memory between runs. Which is intended?" — local, resolvable in one sentence.

A "systemic issue" is something like "The tenant-isolation model isn't actually defined anywhere; multiple sections assume conflicting things." — that needs grilling, not a one-liner.

### 6. File the GitHub issue

When the polish pass is clean:

```bash
gh issue create \
  --title "PRD: <name>" \
  --body-file .nexus/active/<name>/prd-draft.md
```

Capture the new issue number from the output.

If the user prefers a different title (e.g. "PRD: Voice channel support"), confirm before filing.

### 7. Archive the folder

After the issue is filed:

```bash
mv .nexus/active/<name> .nexus/archive/$(date +%Y-%m-%d)-<name>
mv .nexus/archive/<DATE>-<name>/prd-draft.md .nexus/archive/<DATE>-<name>/prd.md
```

The archive folder now holds: `source.md`, `prd.md` (renamed from prd-draft.md), and `prd-context.md` — a complete, immutable record of how this PRD came to be.

### 8. Report

Print to the user:

```
Filed PRD: <name>
GitHub issue: <url>
Archived to: .nexus/archive/<DATE>-<name>/

Next: run `/to-issues #<number>` to break the PRD into vertical-slice implementation issues.
```

## What NOT to do

- Do not synthesize from conversation context. The draft is the synthesis; you're polishing, not creating.
- Do not read or include `prd-context.md` content in the filed issue.
- Do not edit `source.md`. It's a frozen snapshot.
- Do not file an incomplete draft (any `<TBD>`s remaining).
- Do not modify the active folder before the issue is successfully filed — if `gh issue create` fails, leave the draft in place and surface the error.
- Do not include code, file paths, or specific line numbers in the PRD body — even if the draft has them. Translate to domain language.
