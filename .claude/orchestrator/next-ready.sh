#!/usr/bin/env bash
# next-ready.sh — print up to --count ready vertical-slice issues, one per line.
#
# An issue is "ready" when ALL of:
#   - It is open
#   - It is NOT labeled `hitl`
#   - No open PR currently links to it (`Closes #N` / `Fixes #N` / `Resolves #N` in PR body)
#   - Every issue listed under "Blocked by" is closed
#
# Usage:
#   next-ready.sh                  # prints the lowest-numbered ready issue (count = 1)
#   next-ready.sh --count 4        # prints up to 4 ready issue numbers, lowest-first, one per line
#   next-ready.sh --explain        # debug rundown of every open issue and why it is/isn't ready

set -euo pipefail

COUNT=1
EXPLAIN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --count) COUNT="$2"; shift 2 ;;
    --count=*) COUNT="${1#--count=}"; shift ;;
    --explain) EXPLAIN=true; shift ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [ "$COUNT" -lt 1 ]; then
  echo "--count must be a positive integer (got: $COUNT)" >&2
  exit 64
fi

log() { $EXPLAIN && echo "$@" >&2 || true; }

issues_json=$(gh issue list --state open --limit 500 --json number,title,labels,body \
  | jq 'sort_by(.number)')

total=$(echo "$issues_json" | jq 'length')
log "Open issues: $total  |  asking for up to $COUNT ready"

found=0
ready_nums=()

while read -r issue; do
  num=$(echo "$issue" | jq -r '.number')
  title=$(echo "$issue" | jq -r '.title')
  labels=$(echo "$issue" | jq -r '[.labels[].name] | join(",")')
  body=$(echo "$issue" | jq -r '.body // ""')

  log ""
  log "#$num — $title  [labels: ${labels:-none}]"

  if echo ",$labels," | grep -qi ',hitl,'; then
    log "  skip: labeled hitl"
    continue
  fi

  open_prs=$(gh pr list --state open \
    --search "in:body \"Closes #${num}\" OR \"Fixes #${num}\" OR \"Resolves #${num}\"" \
    --json number 2>/dev/null | jq 'length')
  if [ "${open_prs:-0}" -gt 0 ]; then
    log "  skip: $open_prs open PR(s) already linked"
    continue
  fi

  deps=$(echo "$body" | grep -iE 'blocked by' | grep -oE '#[0-9]+' | tr -d '#' | sort -u || true)

  if [ -z "$deps" ]; then
    log "  ready: no blockers"
    ready_nums+=("$num")
    found=$((found + 1))
    [ "$found" -ge "$COUNT" ] && break
    continue
  fi

  all_closed=true
  for d in $deps; do
    state=$(gh issue view "$d" --json state -q .state 2>/dev/null || echo "UNKNOWN")
    log "  dep #$d → $state"
    if [ "$state" != "CLOSED" ]; then
      all_closed=false
    fi
  done

  if $all_closed; then
    log "  ready: all blockers closed"
    ready_nums+=("$num")
    found=$((found + 1))
    [ "$found" -ge "$COUNT" ] && break
  else
    log "  skip: at least one blocker still open"
  fi
done < <(echo "$issues_json" | jq -c '.[]')

if [ "$found" -gt 0 ]; then
  printf '%s\n' "${ready_nums[@]}"
  exit 0
fi

log ""
log "No ready issue found."
exit 1
