FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3080 \
    HOME=/home/autovideo \
    HYPERFRAMES_NO_TELEMETRY=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg chromium fontconfig \
      fonts-dejavu-core fonts-noto-core fonts-noto-cjk \
      gosu tini \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin autovideo

WORKDIR /opt/auto-video-gen

COPY base/package*.json ./base/
COPY dashboard/package*.json ./dashboard/

RUN set -eux; \
    cd /opt/auto-video-gen/base; \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
    cd /opt/auto-video-gen/dashboard; \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . /opt/auto-video-gen

RUN mkdir -p /opt/auto-video-gen/data/uploads \
      /opt/auto-video-gen/downloads \
      /opt/auto-video-gen/base/output \
      /opt/auto-video-gen/branding \
    && chown -R autovideo:autovideo \
      /opt/auto-video-gen/data \
      /opt/auto-video-gen/downloads \
      /opt/auto-video-gen/base/output \
      /opt/auto-video-gen/branding

COPY docker/entrypoint.sh /usr/local/bin/auto-video-entrypoint
RUN chmod 0755 /usr/local/bin/auto-video-entrypoint

WORKDIR /opt/auto-video-gen/dashboard
EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3080/ >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/auto-video-entrypoint"]
CMD ["node", "server.js"]
