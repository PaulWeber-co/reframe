# One image for everything Reframe runs: the dashboard server, the kiosk agent
# (Chromium on the laptop's display), the Docker collector and the media tool.
# Which one runs is the command: server (default), kiosk, services.
#
#   docker build -f docker/Dockerfile -t reframe .
FROM node:22-trixie-slim

ENV DEBIAN_FRONTEND=noninteractive
# chromium, cage and seatd: the kiosk. ffmpeg and v4l-utils: clips, posters and
# the webcam sensor. docker-cli: only for the optional services collector.
# Mesa's VA-API driver lets Chromium decode the background videos on the GPU
# (Intel machines additionally get their media driver).
RUN set -eux; \
    apt-get update; \
    packages="chromium cage seatd curl ca-certificates ffmpeg v4l-utils python3 docker-cli mesa-va-drivers libgl1-mesa-dri fonts-noto-core"; \
    if [ "$(dpkg --print-architecture)" = "amd64" ]; then packages="$packages intel-media-va-driver"; fi; \
    apt-get install -y --no-install-recommends $packages; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/reframe
COPY app/package.json ./app/package.json
COPY app/server ./app/server
COPY app/web ./app/web
COPY host ./host
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh host/reframe-kiosk.sh host/reframe-display host/reframe_media.py \
    && ln -s /opt/reframe/host/reframe-display /usr/local/bin/reframe-display \
    && ln -s /opt/reframe/host/reframe_media.py /usr/local/bin/reframe-media \
    && mkdir -p /data /media /run/reframe \
    && chown -R node:node /data /media /run/reframe

ENV REFRAME_DATA_DIR=/data \
    REFRAME_MEDIA_DIR=/media \
    REFRAME_RUN_DIR=/run/reframe \
    REFRAME_PORT=7777 \
    NODE_ENV=production

EXPOSE 7777
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:7777/api/state -o /dev/null || exit 1

# The server runs as the unprivileged "node" user (uid 1000). The kiosk and
# services commands need devices or the Docker socket and run as root; the
# entrypoint drops to "node" for the server.
ENTRYPOINT ["/opt/reframe/entrypoint.sh"]
CMD ["server"]
