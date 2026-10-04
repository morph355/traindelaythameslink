#!/bin/sh
# Update the running app in place: pull the latest code, rebuild the image
# (cached, so usually seconds) and recreate just the container.
# Never touches .env - that file is git-ignored and only read by compose.
set -e
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env here - create it from .env.example first." >&2; exit 1; }

git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
