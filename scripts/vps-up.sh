#!/usr/bin/env bash
# Bring up the open-source one-box VPS stack (no Fly.io, no Fotium).
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
  echo "Created $env_file — edit Supabase + invite UUID + credential KEK, then re-run." >&2
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

chmod +x "$compose_dir/minio-init.sh"
cd "$compose_dir"
docker compose --env-file .env up -d --build

echo
echo "F-Motion VPS stack is starting."
echo "  Studio:  ${FENGINE_WEB_ORIGIN:-http://127.0.0.1:8080}/app/"
echo "  MinIO:   ${R2_PUBLIC_ENDPOINT:-http://127.0.0.1:9000} (browser uploads)"
echo "Add your Supabase redirect URL: ${FENGINE_WEB_ORIGIN:-http://127.0.0.1:8080}/app/"
echo "Then sign in and connect Pexels/FAL keys under Settings."
