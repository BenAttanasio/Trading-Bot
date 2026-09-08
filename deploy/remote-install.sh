#!/usr/bin/env bash
# remote-install.sh — runs ON THE PI. Installs a release tarball, flips the
# `current` symlink, restarts the service, health-checks, and rolls back on failure.
#
#   bash remote-install.sh <sha> /tmp/trading-bot-<sha>.tar.gz
#
# Layout:
#   ~/trading-bot/releases/<sha>/   dist/, dashboard/dist/, package*.json, node_modules/
#   ~/trading-bot/current -> releases/<sha>
#   ~/trading-bot/shared/.env, shared/logs/
set -euo pipefail

SHA="${1:?release sha required}"
TARBALL="${2:?tarball path required}"
ROOT="/home/pi/trading-bot"
SERVICE="trading-bot"
PORT="${PORT:-3001}"
RELEASE="$ROOT/releases/$SHA"
KEEP_RELEASES=5
export PATH=/home/pi/.npm-global/bin:/usr/local/bin:/usr/bin:/bin

mkdir -p "$ROOT/releases" "$ROOT/shared/logs"

PREVIOUS=""
if [ -L "$ROOT/current" ]; then
  PREVIOUS="$(readlink -f "$ROOT/current")"
fi

echo "==> Extracting release $SHA"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"
tar xzf "$TARBALL" -C "$RELEASE"
rm -f "$TARBALL"

echo "==> Installing production dependencies"
( cd "$RELEASE" && npm ci --omit=dev --no-audit --no-fund --loglevel=error )

if [ ! -f "$ROOT/shared/.env" ]; then
  echo "!! $ROOT/shared/.env is missing — copy it before starting the service" >&2
  exit 2
fi

echo "==> Activating release"
ln -sfn "$RELEASE" "$ROOT/current.tmp"
mv -Tf "$ROOT/current.tmp" "$ROOT/current"
systemctl --user restart "$SERVICE"

echo "==> Health check"
ok=0
for i in $(seq 1 20); do
  sleep 2
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
done

if [ "$ok" -ne 1 ]; then
  echo "!! Health check failed for $SHA" >&2
  journalctl --user -u "$SERVICE" -n 40 --no-pager >&2 || true
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    echo "==> Rolling back to $(basename "$PREVIOUS")" >&2
    ln -sfn "$PREVIOUS" "$ROOT/current.tmp"
    mv -Tf "$ROOT/current.tmp" "$ROOT/current"
    systemctl --user restart "$SERVICE"
  fi
  exit 1
fi

curl -s "http://localhost:$PORT/api/health"; echo

echo "==> Pruning old releases (keeping $KEEP_RELEASES)"
cd "$ROOT/releases"
ls -1t | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  if [ "$ROOT/releases/$old" != "$(readlink -f "$ROOT/current")" ]; then
    rm -rf "$ROOT/releases/$old"
  fi
done

echo "==> Release $SHA is live"
