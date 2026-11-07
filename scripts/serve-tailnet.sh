#!/usr/bin/env bash
# Start the Expo dev server so any device on the tailnet can open it.
#
#   npm run start:tailnet                 (Metro on 8081)
#   npm run start:tailnet -- --port 8082  (extra args go to `expo start`)
#
# The manifest and QR code advertise this machine's MagicDNS name, so Expo Go on a
# phone, an iOS Simulator on another Mac, or a browser elsewhere on the tailnet can
# load the app without sharing a Wi-Fi network.
#
# On macOS and Linux, Metro already listens on every interface, the tailnet one
# included. Inside WSL with NAT networking (the default), the tailnet address belongs
# to Windows, so this script asks Windows' Tailscale to forward the port to WSL's
# localhost relay for as long as Metro runs. Pass --no-forward to skip that. If the
# WSL session is killed rather than stopped with Ctrl-C, the forward stays behind; it
# only refuses connections, the next run replaces it, and
# `tailscale serve --tcp=<port> off` on Windows removes it.
set -euo pipefail

port=8081
forward=1
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --port=*) port="${1#--port=}"; shift ;;
    --no-forward) forward=0; shift ;;
    *) args+=("$1"); shift ;;
  esac
done

is_wsl=0
grep -qi microsoft /proc/version 2>/dev/null && is_wsl=1

# Find a Tailscale CLI. In WSL prefer the Windows one, which owns the tailnet address
# unless Tailscale also runs inside the distro.
ts=""
if command -v tailscale >/dev/null 2>&1; then
  ts="tailscale"
elif [ "$is_wsl" = 1 ] && [ -x "/mnt/c/Program Files/Tailscale/tailscale.exe" ]; then
  ts="/mnt/c/Program Files/Tailscale/tailscale.exe"
elif [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  ts="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi
if [ -z "$ts" ]; then
  echo "Tailscale CLI not found. Install Tailscale and sign in to the tailnet." >&2
  exit 1
fi

# Windows executables read stdin through WSL interop, so give them none.
status="$("$ts" status --json </dev/null)"
host="$(printf '%s' "$status" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const self = JSON.parse(s).Self ?? {};
    process.stdout.write((self.DNSName ?? "").replace(/\.$/, ""));
  });')"
ip="$(printf '%s' "$status" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const ips = JSON.parse(s).Self?.TailscaleIPs ?? [];
    process.stdout.write(ips.find((a) => !a.includes(":")) ?? "");
  });')"
if [ -z "$host" ]; then
  echo "Tailscale is not signed in on this machine (no MagicDNS name)." >&2
  exit 1
fi

# WSL in NAT mode: the tailnet IP is not on any Linux interface. Mirrored networking or
# Tailscale inside the distro puts it there, and then no forward is needed.
cleanup() { :; }
if [ "$is_wsl" = 1 ] && [ "$forward" = 1 ] && ! ip -o addr 2>/dev/null | grep -qF " $ip/"; then
  # Metro listens on IPv6 `::`, which WSL's relay exposes on Windows as [::1].
  "$ts" serve --bg --tcp "$port" "tcp://[::1]:$port" </dev/null >/dev/null
  cleanup() { "$ts" serve --tcp="$port" off </dev/null >/dev/null 2>&1 || true; }
  echo "Forwarding tailnet port $port on Windows to WSL (removed when Metro exits)."
fi
trap cleanup EXIT

echo "Serving on http://$host:$port"
REACT_NATIVE_PACKAGER_HOSTNAME="$host" npx expo start --port "$port" ${args[@]+"${args[@]}"}
