#!/bin/sh
# The wall dashboard on the laptop's display: seatd (a seat manager), cage (a
# Wayland compositor for exactly one program) and Chromium in kiosk mode, as an
# unprivileged user inside the container. reframe_host.py starts and stops
# this script when the control center switches the screen on or off.
set -eu

URL="${REFRAME_KIOSK_URL:-http://127.0.0.1:7777/?kiosk=1}"
PROFILE="${REFRAME_KIOSK_HOME:-/tmp/reframe-kiosk}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp/reframe-runtime}"
mkdir -p "$PROFILE" "$RUNTIME"
chmod 700 "$RUNTIME"
export XDG_RUNTIME_DIR="$RUNTIME"
export HOME="$PROFILE"

# The dashboard starts at the same time. Until it answers, Chromium would show
# its own "site can't be reached" page and stay there. So wait a little; if it
# takes longer, start with a waiting page that switches over by itself as soon
# as the dashboard answers.
start="$URL"
tries=0
until curl -fsS -o /dev/null --max-time 2 "$URL"; do
	tries=$((tries + 1))
	[ "$tries" -eq 1 ] && echo "reframe-kiosk: waiting for the dashboard on port 7777 ..." >&2
	if [ "$tries" -ge 10 ]; then
		echo "reframe-kiosk: the dashboard does not answer yet; showing the waiting page." >&2
		start="file://$PROFILE/waiting.html"
		cat >"$PROFILE/waiting.html" <<-HTML
			<!doctype html><meta charset="utf-8"><title>Reframe</title>
			<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d1f2c;color:#fff;font-family:system-ui,sans-serif;text-align:center">
			<div><div style="font-size:44px;font-weight:300">Reframe is starting …</div>
			<div style="margin-top:18px;font-size:22px;opacity:.7">If this stays for more than a few minutes, check the container logs.</div></div>
			<script>setInterval(() => fetch('$URL', { mode: 'no-cors', cache: 'no-store' }).then(() => location.replace('$URL'), () => {}), 3000)</script>
		HTML
		break
	fi
	sleep 2
done

# A restart (every night, or a power cut) is no crash: no "restore pages?"
prefs="$PROFILE/chromium/Default/Preferences"
if [ -f "$prefs" ]; then
	sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/' "$prefs" || true
fi

# Chromium decodes the background videos on the GPU where it can (VA-API); no
# keyring, no update or crash bubbles, no swipe-back on the touchpad, no
# translation offer. ?kiosk=1 tells the page it is the wall display: only here
# a dark screen goes black and a tap wakes it.
export LIBSEAT_BACKEND=seatd
exec seatd-launch -- cage -s -- chromium --kiosk --no-sandbox --ozone-platform=wayland \
	--enable-features=AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder \
	--disable-features=TranslateUI --autoplay-policy=no-user-gesture-required \
	--no-first-run --no-default-browser-check --disable-infobars --disable-session-crashed-bubble --noerrdialogs \
	--password-store=basic --overscroll-history-navigation=0 --check-for-update-interval=31536000 \
	--user-data-dir="$PROFILE/chromium" "$start"
