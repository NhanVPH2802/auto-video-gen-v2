#!/bin/sh
set -eu
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-auto-video-gen-runtime-${STAMP}.tar.gz}"
tar -czf "$OUT" runtime
echo "Backup: $OUT"
