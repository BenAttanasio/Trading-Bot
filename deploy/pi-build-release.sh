#!/usr/bin/env bash
# pi-build-release.sh — runs ON THE PI, launched detached by the self-improve
# pipeline (systemd-run) after a change request is merged. Builds a release from
# the repo checkout at a given commit and hands it to remote-install.sh.
#
#   bash pi-build-release.sh /home/pi/trading-bot/repo <sha>
set -euo pipefail

REPO="${1:?repo dir required}"
SHA="${2:?commit sha required}"
ROOT="/home/pi/trading-bot"
export PATH=/home/pi/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
BUILD="$(mktemp -d /tmp/tb-build-XXXXXX)"
STAGE="$BUILD/stage"
LOG="$ROOT/shared/logs/pi-build-$SHA.log"
mkdir -p "$ROOT/shared/logs"
exec > >(tee -a "$LOG") 2>&1

echo "==> [$(date -Is)] Building release $SHA from $REPO"
mkdir -p "$BUILD/src"
git -C "$REPO" archive "$SHA" | tar -x -C "$BUILD/src"

cd "$BUILD/src"
echo "==> npm ci (backend)"
npm ci --no-audit --no-fund --loglevel=error
echo "==> tsc"
npm run build
echo "==> npm ci (dashboard)"
( cd dashboard && npm ci --no-audit --no-fund --loglevel=error && npm run build )

echo "==> Staging"
mkdir -p "$STAGE/dashboard"
cp -r dist "$STAGE/dist"
cp -r dashboard/dist "$STAGE/dashboard/dist"
cp package.json package-lock.json "$STAGE/"
[ -d playbook ] && cp -r playbook "$STAGE/playbook"
printf '%s' "$SHA" > "$STAGE/RELEASE"
TAR="/tmp/trading-bot-$SHA.tar.gz"
tar czf "$TAR" -C "$STAGE" .

# Keep the installer current with the code being shipped.
cp "$BUILD/src/deploy/remote-install.sh" "$ROOT/remote-install.sh"

echo "==> Installing"
PORT="${PORT:-3001}" bash "$ROOT/remote-install.sh" "$SHA" "$TAR"
rm -rf "$BUILD"
echo "==> [$(date -Is)] Done"
