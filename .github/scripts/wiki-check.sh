#!/usr/bin/env bash
# Wiki drift check. Lists wiki pages that cite files changed in a git range,
# and flags feat changes / new source files no wiki page explains yet.
# Advisory only — writes a job summary and warnings, never fails the job.
#   usage: wiki-check.sh <git-range> <wiki-dir> [pr-title]
set -euo pipefail
range=$1 wiki=$2 title=${3:-}
summary=${GITHUB_STEP_SUMMARY:-/dev/stdout}

# page<TAB>cited-path for every `src/…`, `prisma/…`, `scripts/…` the wiki cites
# (a `path::symbol` citation matches on the path).
cites=$(grep -oE '`(src|prisma|scripts)/[^` ]+`' "$wiki"/*.md | tr -d '`' |
  sed -E 's#^.*/([^/:]+)\.md:#\1\t#; s#::.*$##' | sort -u || true)

page_for() { # prints pages citing $1 (exact path, or a cited directory prefix)
  awk -F'\t' -v f="$1" '$2 == f || (substr($2, length($2)) == "/" && index(f, $2) == 1) { print $1 }' <<<"$cites"
}

# --no-renames splits a rename into delete + add, so the old (now stale) path
# is checked too; deleted files are included for the same reason.
mapfile -t changed < <(git diff --name-only --no-renames --diff-filter=AMD "$range" -- src prisma scripts)
mapfile -t added < <(git diff --name-only --no-renames --diff-filter=A "$range" -- src/app src/lib scripts |
  grep -vE '(__tests__|\.test\.|/generated/)' || true)

declare -A hits=()
for f in "${changed[@]}"; do
  while IFS= read -r p; do [ -n "$p" ] && hits[$p]+=" \`$f\`"; done < <(page_for "$f")
done

uncovered=()
for f in "${added[@]}"; do [ -z "$(page_for "$f")" ] && uncovered+=("$f"); done

# A...B diffs from the merge base, but `git log A...B` is symmetric — log
# A..B so only commits on the PR side count.
feats=$( { [ -n "$title" ] && echo "$title"; git log --format=%s "${range/.../..}"; } |
  grep -E '^feat(\([^)]*\))?!?:' | sort -u || true)

{
  echo "## Wiki check"
  if [ ${#hits[@]} -gt 0 ]; then
    echo; echo "These wiki pages describe code this change touches — check they're still accurate:"; echo
    for p in $(printf '%s\n' "${!hits[@]}" | sort); do echo "- **$p** —${hits[$p]}"; done
  fi
  if [ -n "$feats" ]; then
    echo; echo "New features — each needs a wiki page (new or extended) explaining what it does and who can use it:"; echo
    sed 's/^/- /' <<<"$feats"
  fi
  if [ ${#uncovered[@]} -gt 0 ]; then
    echo; echo "New source files no wiki page mentions yet:"; echo
    printf -- '- `%s`\n' "${uncovered[@]}"
  fi
  [ ${#hits[@]} -eq 0 ] && [ -z "$feats" ] && [ ${#uncovered[@]} -eq 0 ] && echo && echo "Nothing to update."
} >>"$summary"

while IFS= read -r t; do [ -n "$t" ] && echo "::warning title=Wiki::Explain this feature in the wiki — $t"; done <<<"$feats"
[ ${#hits[@]} -gt 0 ] && echo "::notice title=Wiki::${#hits[@]} wiki page(s) cite changed files — see job summary"
exit 0
