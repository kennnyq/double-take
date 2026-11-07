#!/usr/bin/env bash
# Copy the gitignored local env files from the main checkout into this git worktree.
#
#   npm run worktree:env          (run inside the new worktree)
#
# Copies only files that exist in the main checkout and are missing here, owner-only
# (chmod 600), and never prints their contents. All of them are gitignored.
#   .env.local          app: API URL and demo passcode (Expo loads it)
#   scripts/annotate/.env.local   annotation pipeline: NVIDIA_API_KEY (kept out of the
#                                 root, where Expo's dev server would bundle it)
#   worker/.dev.vars    local Worker secrets (wrangler dev)
#   worker/.prod.vars   prod passcode for the end-to-end tests
set -euo pipefail

here="$(git rev-parse --show-toplevel)"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
if [ "$here" = "$main" ]; then
  echo "This is the main checkout; run this inside a worktree."
  exit 0
fi

for f in .env.local scripts/annotate/.env.local worker/.dev.vars worker/.prod.vars; do
  if [ ! -f "$main/$f" ]; then
    echo "skip  $f (not in the main checkout)"
  elif [ -f "$here/$f" ]; then
    echo "keep  $f (already here)"
  else
    mkdir -p "$(dirname "$here/$f")"
    (umask 077 && cp "$main/$f" "$here/$f")
    chmod 600 "$here/$f"
    echo "copy  $f"
  fi
done
