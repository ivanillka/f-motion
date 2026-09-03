#!/usr/bin/env bash
# Bring up the hosted f-motion.com stack on a Hetzner VPS (no Fly.io).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
compose_dir="$root/deploy/hetzner"
env_file="$compose_dir/.env"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is required" >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  cp "$compose_dir/.env.example" "$env_file"
  echo "Created $env_file — fill hosted secrets, then re-run." >&2
  exit 1
fi

if grep -E '^(VITE_ALLOW_DEMO_AUTH|FENGINE_LOCAL_AUTH)=.+' "$env_file" >/dev/null; then
  echo "deploy/hetzner/.env must not set demo or local-auth values." >&2
  exit 1
fi
if grep -E '^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_ISSUER|SUPABASE_JWKS_URL|DATABASE_URL|R2_ENDPOINT|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)=.*(YOUR_|replace-with|PASSWORD@HOST)' "$env_file" >/dev/null; then
  echo "Replace the placeholders in deploy/hetzner/.env before starting." >&2
  exit 1
fi
if grep -E '^FENGINE_CREDENTIAL_KEY_V1=replace-with' "$env_file" >/dev/null; then
  echo "Generate FENGINE_CREDENTIAL_KEY_V1 with: openssl rand -base64 32" >&2
  exit 1
fi

fengine_env="$(grep -E '^FENGINE_ENV=' "$env_file" | head -1 | cut -d= -f2- || true)"
access_mode="$(grep -E '^FENGINE_ACCESS_MODE=' "$env_file" | head -1 | cut -d= -f2- || true)"
allowed_ids="$(grep -E '^FENGINE_ALLOWED_USER_IDS=' "$env_file" | head -1 | cut -d= -f2- || true)"
if [[ "$fengine_env" != "hosted" ]]; then
  echo "Hosted Hetzner requires FENGINE_ENV=hosted." >&2
  exit 1
fi
if [[ "$access_mode" != "invite_only" ]]; then
  echo "Hosted Hetzner requires FENGINE_ACCESS_MODE=invite_only." >&2
  exit 1
fi
seat_count=0
IFS=',' read -ra _seat_parts <<< "$allowed_ids"
for _seat in "${_seat_parts[@]}"; do
  _trimmed="${_seat#"${_seat%%[![:space:]]*}"}"
  _trimmed="${_trimmed%"${_trimmed##*[![:space:]]}"}"
  if [[ -n "$_trimmed" ]]; then
    seat_count=$((seat_count + 1))
  fi
done
if [[ "$seat_count" -lt 1 ]]; then
  echo "Hosted Hetzner requires at least one FENGINE_ALLOWED_USER_IDS entry." >&2
  exit 1
fi

cd "$compose_dir"
VITE_GIT_SHA="$(git -C "$root" rev-parse HEAD 2>/dev/null || echo dev)"
export VITE_GIT_SHA
VITE_APP_VERSION="$(node -e "console.log(require('$root/package.json').version)" 2>/dev/null || echo unknown)"
export VITE_APP_VERSION
docker compose --env-file .env up -d --build

echo
echo "F-Motion ${VITE_APP_VERSION} Hetzner origin is starting."
echo "  Site:    ${FENGINE_WEB_ORIGIN:-http://127.0.0.1}/"
echo "  API:     point api.f-motion.com at this VPS, then curl /healthz"
echo "  Version: ${VITE_APP_VERSION}"
echo "  Build:   ${VITE_GIT_SHA}"
echo "Destroy the Fly apps after that health check succeeds."
