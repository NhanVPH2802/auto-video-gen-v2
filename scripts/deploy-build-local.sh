#!/bin/sh
set -eu
mkdir -p runtime/data runtime/downloads runtime/output runtime/branding
docker compose build
docker compose up -d
docker compose ps
