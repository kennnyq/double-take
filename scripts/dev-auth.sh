#!/usr/bin/env bash
# Run the Worker's dev-only test-account routes (worker/src/devAuth.ts) for the
# app's dev Accounts tab, reachable from the whole tailnet.
#
#   npm run dev:auth                 (port 8788)
#   npm run dev:auth -- --port 8790
#
# Needs DEV_AUTH=1, SUPABASE_URL and SUPABASE_SECRET_KEY in worker/.dev.vars.
# Web builds call http://<the page's host>:8788; Expo Go on a phone uses
# EXPO_PUBLIC_DEV_AUTH_URL from .env.local. Inside WSL with NAT networking, this
# asks Windows' Tailscale to forward the port, like scripts/serve-tailnet.sh does
# for Metro, and removes the forward on exit.
set -euo pipefail

port=8788
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --port=*) port="${1#--port=}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/../worker"
if ! grep -q '^DEV_AUTH=1' .dev.vars 2>/dev/null; then
  echo "worker/.dev.vars has no DEV_AUTH=1; the /dev/* routes would all 404." >&2
  exit 1
fi

cleanup() { :; }
ts="/mnt/c/Program Files/Tailscale/tailscale.exe"
if grep -qi microsoft /proc/version 2>/dev/null && [ -x "$ts" ] && ! command -v tailscale >/dev/null 2>&1; then
  ip="$("$ts" ip -4 </dev/null 2>/dev/null | head -1 || true)"
  if [ -n "$ip" ] && ! ip -o addr 2>/dev/null | grep -qF " $ip/"; then
    "$ts" serve --bg --tcp "$port" "tcp://127.0.0.1:$port" </dev/null >/dev/null
    cleanup() { "$ts" serve --tcp="$port" off </dev/null >/dev/null 2>&1 || true; }
    echo "Forwarding tailnet port $port on Windows to WSL (removed on exit)."
  fi
fi
trap cleanup EXIT

npx wrangler dev -c wrangler.dev-auth.jsonc --ip 0.0.0.0 --port "$port"
