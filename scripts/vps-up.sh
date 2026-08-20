#!/usr/bin/env bash
# Bring up the open-source single-seat VPS stack (no Fly.io, no Fotium).
# Multi-user / team seats are the paid corporate product — not this script.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
compose_dir="$root/deploy/vps"
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
  echo "Created $env_file — set Supabase, ONE owner UUID, and FENGINE_CREDENTIAL_KEY_V1, then re-run." >&2
  exit 1
fi

# Fail closed on Fotium / demo knobs if someone copied a hosted .env.
if grep -E '^(VITE_PARTNER_BRAND_EMAIL|FENGINE_IMPORT_TOKEN|SUPABASE_ISSUER_EXTRA|VITE_ALLOW_DEMO_AUTH|FENGINE_LOCAL_AUTH)=.+' "$env_file" >/dev/null; then
  echo "deploy/vps/.env must not set Fotium, import, demo, or local-auth values." >&2
  exit 1
fi
if grep -E '^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_ISSUER|SUPABASE_JWKS_URL)=.*(YOUR_PROJECT|example\.supabase|replace-with)' "$env_file" >/dev/null; then
  echo "Replace the Supabase placeholders in deploy/vps/.env before starting." >&2
  exit 1
fi
if grep -E '^FENGINE_CREDENTIAL_KEY_V1=replace-with' "$env_file" >/dev/null; then
  echo "Generate FENGINE_CREDENTIAL_KEY_V1 with: openssl rand -base64 32" >&2
  exit 1
fi

# Open source = single seat. Several users = corporate / paid (not this path).
fengine_env="$(grep -E '^FENGINE_ENV=' "$env_file" | head -1 | cut -d= -f2- || true)"
access_mode="$(grep -E '^FENGINE_ACCESS_MODE=' "$env_file" | head -1 | cut -d= -f2- || true)"
allowed_ids="$(grep -E '^FENGINE_ALLOWED_USER_IDS=' "$env_file" | head -1 | cut -d= -f2- || true)"
if [[ -n "$fengine_env" && "$fengine_env" != "selfhost" ]]; then
  echo "Open-source VPS requires FENGINE_ENV=selfhost. Multi-seat is the paid corporate product." >&2
  exit 1
fi
if [[ -n "$access_mode" && "$access_mode" != "single_user" ]]; then
  echo "Open-source VPS requires FENGINE_ACCESS_MODE=single_user. Multi-seat is the paid corporate product." >&2
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
if [[ "$seat_count" -ne 1 ]]; then
  echo "Open-source VPS allows exactly one FENGINE_ALLOWED_USER_IDS entry. Multi-user is paid." >&2
  exit 1
fi

chmod +x "$compose_dir/minio-init.sh"
cd "$compose_dir"
docker compose --env-file .env up -d --build

echo
echo "F-Motion single-seat VPS stack is starting."
echo "  Studio:  ${FENGINE_WEB_ORIGIN:-http://127.0.0.1:8080}/app/"
echo "  MinIO:   ${R2_PUBLIC_ENDPOINT:-http://127.0.0.1:9000} (browser uploads)"
echo "Add your Supabase redirect URL: ${FENGINE_WEB_ORIGIN:-http://127.0.0.1:8080}/app/"
echo "Sign in as the one allowlisted user, then connect Pexels/FAL under Settings."
