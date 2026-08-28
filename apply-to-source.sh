#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${1:-/opt/auto-video-gen-github}"
DASHBOARD="$REPO_ROOT/dashboard"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)/app"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/auto-video-gen-source-backups}"

if [ ! -d "$REPO_ROOT/base" ] || [ ! -d "$DASHBOARD" ]; then
  echo "Khong tim thay source Docker tai: $REPO_ROOT" >&2
  exit 1
fi

BACKUP="$BACKUP_ROOT/dashboard-before-preview2.7.0-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_ROOT"
cp -a "$DASHBOARD" "$BACKUP"

ENV_TMP=""
if [ -f "$DASHBOARD/.env.local" ]; then
  ENV_TMP="$(mktemp)"
  cp "$DASHBOARD/.env.local" "$ENV_TMP"
fi

rm -rf "$DASHBOARD"
mkdir -p "$DASHBOARD"
cp -a "$SOURCE_DIR/." "$DASHBOARD/"
rm -rf "$DASHBOARD/node_modules"
rm -f "$DASHBOARD/.env"
if [ -n "$ENV_TMP" ] && [ -f "$ENV_TMP" ]; then
  cp "$ENV_TMP" "$DASHBOARD/.env.local"
  rm -f "$ENV_TMP"
fi

# Apply the same VieNeu-TTS stability patch to repository base source.
if [ -d "$REPO_ROOT/base/src/tts" ] && [ -f "$REPO_ROOT/base/src/pipeline.ts" ]; then
  mkdir -p "$BACKUP/base-src/tts"
  cp -a "$REPO_ROOT/base/src/pipeline.ts" "$BACKUP/base-src/pipeline.ts"
  [ -f "$REPO_ROOT/base/src/config.ts" ] && cp -a "$REPO_ROOT/base/src/config.ts" "$BACKUP/base-src/config.ts" || true
  [ -f "$REPO_ROOT/base/src/tts/vieneu-client.ts" ] && cp -a "$REPO_ROOT/base/src/tts/vieneu-client.ts" "$BACKUP/base-src/tts/vieneu-client.ts" || true
  [ -d "$REPO_ROOT/base/src/render" ] && cp -a "$REPO_ROOT/base/src/render" "$BACKUP/base-src/render" || true
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-tts-stability.sh" "$REPO_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-source-social-footer.sh" "$REPO_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-theme-validator.sh" "$REPO_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-video-appearance.sh" "$REPO_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-render-fixes.sh" "$REPO_ROOT/base"
fi

cd "$DASHBOARD"
npm run check

echo "Da cap nhat source len Preview 2.7.0: $DASHBOARD"
echo "Backup local: $BACKUP"
echo "Tiep theo: cd $REPO_ROOT && docker compose build auto-video-gen && docker compose up -d --force-recreate"
