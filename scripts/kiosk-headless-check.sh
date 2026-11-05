#!/bin/sh
# Checks the whole kiosk chain on a machine without a display: the demo server,
# cage (Wayland compositor, headless backend, no seat daemon) and Chromium in
# kiosk mode, then a screenshot of what the compositor shows.
#
#   scripts/kiosk-headless-check.sh                    uses `chromium`
#   REFRAME_CHROMIUM=google-chrome scripts/kiosk-headless-check.sh
#
# Needs: node, cage, grim and a Chromium or Chrome. It proves the scripts, the
# flags and the seat-less start work; it cannot prove that a particular graphics
# card lets a program take over the screen: see docs/hardware.md.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
port="${REFRAME_CHECK_PORT:-7791}"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$work"' EXIT INT TERM

REFRAME_PORT="$port" REFRAME_HOST=127.0.0.1 REFRAME_DATA_DIR="$work/data" \
	node "$root/app/server/index.js" --demo >"$work/server.log" 2>&1 &

for i in $(seq 1 30); do
	curl -fsS "http://127.0.0.1:$port/api/state" -o /dev/null 2>/dev/null && break
	sleep 1
done
curl -fsS "http://127.0.0.1:$port/api/state" -o /dev/null || { echo "the demo server did not start:"; cat "$work/server.log"; exit 1; }

export XDG_RUNTIME_DIR="$work/runtime"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
REFRAME_KIOSK_HEADLESS=1 REFRAME_KIOSK_SEAT=noop REFRAME_KIOSK_HOME="$work/kiosk" \
	REFRAME_KIOSK_URL="http://127.0.0.1:$port/?kiosk=1" \
	sh "$root/host/reframe-kiosk.sh" >"$work/kiosk.log" 2>&1 &

for i in $(seq 1 40); do
	[ -S "$XDG_RUNTIME_DIR/wayland-0" ] && break
	sleep 1
done
[ -S "$XDG_RUNTIME_DIR/wayland-0" ] || { echo "cage did not create a Wayland socket:"; cat "$work/kiosk.log"; exit 1; }

sleep 12 # Chromium starts and the page draws
WAYLAND_DISPLAY=wayland-0 grim "$work/screen.png"
size="$(wc -c <"$work/screen.png")"
echo "the compositor's screenshot is $size bytes"
# A blank screen compresses to a few kilobytes; the dashboard is far bigger
if [ "$size" -lt 100000 ]; then
	echo "the screen looks empty"
	cat "$work/kiosk.log"
	exit 1
fi
[ -n "${REFRAME_CHECK_SAVE:-}" ] && cp "$work/screen.png" "$REFRAME_CHECK_SAVE"
echo "kiosk chain OK"
