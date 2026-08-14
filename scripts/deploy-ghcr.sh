#!/bin/sh
set -eu

REMOTE="${1:-$(git config --get remote.origin.url || true)}"

if [ -z "$REMOTE" ]; then
  echo "Khong xac dinh duoc Git remote." >&2
  exit 1
fi

REPO="$(printf '%s' "$REMOTE" | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\.git$##')"
IMAGE="ghcr.io/$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]'):latest"
export IMAGE

mkdir -p runtime/data runtime/downloads runtime/output runtime/branding

echo "Image: $IMAGE"
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
docker compose -f docker-compose.ghcr.yml ps
