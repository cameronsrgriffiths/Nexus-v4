#!/bin/bash
#
# PreToolUse guardrail for Bash. Blocks destructive git operations.
#
# Calibrated for the /orchestrate workflow: agents NEED to push feature branches
# to open PRs, so plain `git push` is allowed. Force-push, push-to-main, and the
# usual destructive ops are still blocked.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

DANGEROUS_PATTERNS=(
  # --- Force pushes (every shape I can think of) ---
  "git push.*--force"           # --force, --force-with-lease, --force-if-includes
  "git push [+][^ ]+"           # +refspec is force (literal +, escaped via class)
  "git push .* -f( |$)"         # -f flag, somewhere after other args
  "git push -f( |$)"            # -f flag, immediately after push

  # --- Bulk pushes ---
  "git push.*--mirror"
  "git push.*--all"

  # --- Pushing to main/master (any form) ---
  "git push.*[: ](main|master)( |$)"
  "git push.*(main|master):"

  # --- Original destructive ops ---
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \\."
  "git restore \\."
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
