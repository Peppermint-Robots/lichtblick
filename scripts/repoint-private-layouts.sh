#!/usr/bin/env bash
# Re-point the private-layouts submodule at main after its PR has been squash-merged.
#
# A squash merge creates a NEW commit on main with the same tree but a different SHA, so the
# submodule pointer recorded here still names the pre-merge commit — which only ever existed on the
# feature branch and disappears when that branch is deleted. Anyone cloning the fork then gets
# "reference is not a tree" on `git submodule update`.
#
# This verifies the merged main carries the identical tree (i.e. the PR really is what we pointed
# at) and then records the merged SHA. Run from anywhere inside the fork, after the PR is merged.
set -euo pipefail

SUB=packages/suite-base/src/layouts/private

cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: fork has uncommitted changes; commit or stash them first" >&2
  exit 1
fi

before=$(git rev-parse "HEAD:$SUB")
before_tree=$(git -C "$SUB" rev-parse "$before^{tree}")

git -C "$SUB" fetch origin main
git -C "$SUB" checkout main
git -C "$SUB" reset --hard origin/main

after=$(git -C "$SUB" rev-parse HEAD)
after_tree=$(git -C "$SUB" rev-parse "HEAD^{tree}")

if [ "$before" = "$after" ]; then
  echo "already pointing at the merged commit ($after); nothing to do"
  exit 0
fi

# The squash keeps the tree identical. A mismatch means main moved on beyond our PR, so stop rather
# than silently pull in someone else's layout changes.
if [ "$before_tree" != "$after_tree" ]; then
  echo "error: merged main has a different tree than the commit we pointed at." >&2
  echo "  ours:   $before (tree $before_tree)" >&2
  echo "  origin: $after (tree $after_tree)" >&2
  echo "Review 'git -C $SUB log --oneline $before..origin/main' before re-pointing by hand." >&2
  exit 1
fi

git add "$SUB"
git commit -m "chore(layouts): point private submodule at squash-merged main

The private-layouts PR was squash-merged, which rewrote it onto main under
a new SHA. Record the merged commit so a fresh clone can resolve the
submodule; the tree is unchanged."

echo
echo "re-pointed $SUB:"
echo "  $before -> $after"
echo "now push the fork:  git push origin $(git rev-parse --abbrev-ref HEAD)"
