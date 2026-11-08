#!/usr/bin/env bash
# Build the web app for production and host it on Cloudflare as the static
# Worker `double-take-app` (web/wrangler.jsonc), so a demo doesn't depend on a
# dev server.
#
#   npm run deploy:web            build and deploy
#   npm run deploy:web -- --build build only (dist/), no deploy
#
# The build ignores .env files (EXPO_NO_DOTENV) and gets its public config
# explicitly: the cloud media API, and the demo passcode and Supabase keys
# read from ENV_FILE (default: the main checkout's .env.local). Values are
# never printed. The jobs runner (plain HTTP on the tailnet) can't be reached
# from an HTTPS page, so it's left unset: the Create card shows itself as
# unavailable.
#
# Deploying needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for the
# account that hosts it (for Kenny's second account:
# CLOUDFLARE_ACCOUNT_ID=31c7eb4766be7bc987a69ff65c941fe3 and the token in
# ~/.config/cloudflare/token-alt, used when CLOUDFLARE_API_TOKEN isn't set).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-$HOME/Developer/double-take/.env.local}"
API_URL="${API_URL:-https://double-take-api.fuzzywuzzygordon.workers.dev}"

# One value from the env file, without echoing it.
read_env() {
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  v="${v%\"}"
  v="${v#\"}"
  printf '%s' "$v"
}

[ -f "$ENV_FILE" ] || { echo "No env file at $ENV_FILE (set ENV_FILE)." >&2; exit 1; }
for k in EXPO_PUBLIC_DEMO_PASSCODE EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
  [ -n "$(read_env "$k")" ] || { echo "$k is missing from $ENV_FILE." >&2; exit 1; }
done

echo "Building the web app (production, API: $API_URL)…"
env -u EXPO_PUBLIC_JOBS_URL -u EXPO_PUBLIC_REVIEW_URL -u EXPO_PUBLIC_DEV_AUTH_URL \
  EXPO_NO_DOTENV=1 \
  NODE_ENV=production \
  EXPO_PUBLIC_API_URL="$API_URL" \
  EXPO_PUBLIC_DEMO_PASSCODE="$(read_env EXPO_PUBLIC_DEMO_PASSCODE)" \
  EXPO_PUBLIC_SUPABASE_URL="$(read_env EXPO_PUBLIC_SUPABASE_URL)" \
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(read_env EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)" \
  EXPO_PUBLIC_JOBS_URL= \
  EXPO_PUBLIC_REVIEW_URL= \
  npx expo export -p web --output-dir dist

[ "${1:-}" = "--build" ] && { echo "Built dist/ (not deployed)."; exit 0; }

: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID for the account that hosts the app.}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CLOUDFLARE_API_TOKEN="$(cat "$HOME/.config/cloudflare/token-alt")"
  export CLOUDFLARE_API_TOKEN
fi
echo "Deploying dist/ as double-take-app…"
NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first" npx --yes wrangler@4.158.0 deploy --config web/wrangler.jsonc
