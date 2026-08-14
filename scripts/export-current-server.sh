#!/bin/sh
set -eu

SRC="${1:-/opt/auto-video-gen}"
DST="${2:-/opt/auto-video-gen-github}"

if [ ! -d "$SRC/dashboard" ] || [ ! -d "$SRC/base" ]; then
  echo "Khong tim thay dashboard/base trong: $SRC" >&2
  exit 1
fi

rm -rf "$DST"
mkdir -p "$DST"

tar -C "$SRC" \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='dashboard/.env.local' \
  --exclude='base/.env.local' \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  --exclude='data' \
  --exclude='downloads' \
  --exclude='output' \
  --exclude='base/output' \
  --exclude='backups' \
  --exclude='*/backups' \
  --exclude='.cache' \
  --exclude='*/.cache' \
  --exclude='*.log' \
  -cf - . | tar -C "$DST" -xf -

echo "Da xuat source sach vao: $DST"
