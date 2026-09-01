#!/usr/bin/env bash
# Deploy current checkout to a self-host VPS over SSH.
# Usage: F_MOTION_VPS_HOST=your.vps.host bash scripts/vps-selfhost-deploy.sh
#    or: bash scripts/vps-selfhost-deploy.sh your.vps.host
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
host="${1:-${F_MOTION_VPS_HOST:-}}"
remote_dir="${F_MOTION_VPS_DIR:-/opt/f-motion-selfhost}"
if [[ -z "$host" ]]; then
  echo "Set F_MOTION_VPS_HOST or pass the VPS host as the first argument." >&2
  exit 1
fi
sha="$(git -C "$root" rev-parse HEAD)"
version="$(node -e "console.log(require('$root/package.json').version)")"

echo "Deploying F-Motion ${version} (${sha:0:12}) to ${host}:${remote_dir}"

(cd "$root" && git ls-files -co --exclude-standard | tar -cf - -T -) | ssh "${F_MOTION_VPS_USER:-root}@${host}" "
  set -euo pipefail
  cd '${remote_dir}'
  tar xf - --exclude=deploy --exclude=compose.selfhost.yaml --exclude=docker-compose.yml
  if grep -q '^ENV VITE_GIT_SHA=' deploy/Dockerfile; then
    sed -i \"s/^ENV VITE_GIT_SHA=.*/ENV VITE_GIT_SHA=${sha}/\" deploy/Dockerfile
  fi
  if grep -q 'VITE_APP_VERSION=' deploy/Dockerfile; then
    sed -i \"s/^ENV VITE_APP_VERSION=.*/ENV VITE_APP_VERSION=${version}/\" deploy/Dockerfile
  elif grep -q '^ENV VITE_GIT_SHA=' deploy/Dockerfile; then
    sed -i \"s/^ENV VITE_GIT_SHA=.*/ENV VITE_GIT_SHA=${sha} VITE_APP_VERSION=${version}/\" deploy/Dockerfile
  fi
  grep -E 'VITE_GIT_SHA|VITE_APP_VERSION' deploy/Dockerfile | head -3
  docker compose -f compose.selfhost.yaml build
  docker compose -f compose.selfhost.yaml up -d
  echo '--- health ---'
  sleep 3
  curl -fsS http://127.0.0.1:3000/healthz || true
"

echo "Done. Rebuild finished for ${version}."
