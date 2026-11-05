#!/bin/sh
# What the container runs, by its first argument:
#
#   server     the dashboard (default), as the unprivileged user "node"
#   kiosk      the host agent: Chromium on the display, backlight, webcam
#   services   the Docker collector for the Services tile
#   <other>    run as given, e.g. reframe-media add day /clips/coast.mov
set -eu

cd /opt/reframe
export PATH="/opt/reframe/host:$PATH"

as_node() {
	# Re-run this script as "node" when started as root (a bind-mounted data
	# folder is then fixed up first, so a fresh install just works)
	if [ "$(id -u)" = "0" ]; then
		chown node:node "$REFRAME_DATA_DIR" "$REFRAME_MEDIA_DIR" 2>/dev/null || true
		exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
	fi
}

case "${1:-server}" in
	server)
		as_node "$@"
		mkdir -p "$REFRAME_DATA_DIR"
		# Still pictures for clips that lack one (best effort, never blocks the start)
		python3 host/reframe_media.py posters >/dev/null 2>&1 || true
		exec node app/server/index.js
		;;
	kiosk)
		exec python3 host/reframe_host.py
		;;
	services)
		exec python3 host/reframe_services.py
		;;
	*)
		exec "$@"
		;;
esac
