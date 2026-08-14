#!/bin/sh
set -eu

mkdir -p \
  /opt/auto-video-gen/data/uploads \
  /opt/auto-video-gen/downloads \
  /opt/auto-video-gen/base/output \
  /opt/auto-video-gen/branding

chown -R autovideo:autovideo \
  /opt/auto-video-gen/data \
  /opt/auto-video-gen/downloads \
  /opt/auto-video-gen/base/output \
  /opt/auto-video-gen/branding

exec gosu autovideo "$@"
