#!/bin/bash
#
# Builds a clean folder to drag onto Netlify.
#
# Drag-and-drop uploads a folder exactly as it sits on disk — it does not read
# .gitignore. Dropping the project itself would publish .env (the Supabase
# secret key, the Brevo key and the dashboard password) and the whole .git
# history, both of which are served with a 200 by default.
#
# This copies only what the site needs into _deploy/. Drag that folder instead.
#
#   ./make-deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")"
OUT=_deploy

rm -rf "$OUT"
mkdir -p "$OUT"

# Everything except secrets, version control, tooling and internal notes.
# netlify/ must come along — that's where the serverless functions live.
rsync -a \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.git' \
  --exclude '.github' \
  --exclude '.claude' \
  --exclude '.netlify' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  --exclude 'HANDOFF.md' \
  --exclude 'readme.md' \
  --exclude 'db' \
  --exclude '_deploy' \
  --exclude 'make-deploy.sh' \
  ./ "$OUT/"

echo "Built $OUT/"
echo

# Anything matching these in the output is a bug in the exclude list above.
if find "$OUT" \( -name '.env*' -o -name '.git' -o -name '.DS_Store' \) -print | grep -q .; then
  echo "REFUSING: secrets or version control made it into $OUT" >&2
  exit 1
fi

echo "Checked: no .env, no .git, no .DS_Store."
echo "Drag $(pwd)/$OUT onto Netlify."
