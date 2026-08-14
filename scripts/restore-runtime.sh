#!/bin/sh
set -eu
ARCHIVE="${1:?Usage: restore-runtime.sh <backup.tar.gz>}"
docker compose down 2>/dev/null || true
docker compose -f docker-compose.ghcr.yml down 2>/dev/null || true
tar -xzf "$ARCHIVE"
echo "Da restore runtime."
