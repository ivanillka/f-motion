#!/usr/bin/env bash
# Open-source F-Motion installer (single seat).
# Multi-user / team seats are the paid corporate product — not this path.
#
# Usage (from a clone of this repository):
#   ./install.sh
#
# Requires: Docker Engine + Compose v2, openssl, a Supabase project you control.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
compose_dir="$root/deploy/vps"
env_file="$compose_dir/.env"
example="$compose_dir/.env.example"

die() {
  echo "install: $*" >&2
  exit 1
}

echo "F-Motion open-source install (single seat)"
product_version="$(node -e "console.log(require('$root/package.json').version)" 2>/dev/null || echo unknown)"
echo "Version ${product_version}"
echo "Corporate multi-user is a separate paid product."
echo

command -v docker >/dev/null 2>&1 || die "Docker is required (https://docs.docker.com/get-docker/)"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is required"
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate the credential key"

[[ -f "$example" ]] || die "missing $example — run this from a full repository checkout"
[[ -f "$root/scripts/vps-up.sh" ]] || die "missing scripts/vps-up.sh"

if [[ ! -f "$env_file" ]]; then
  cp "$example" "$env_file"
  echo "Created $env_file from the example."
fi

# Fill a real credential KEK when the placeholder is still present.
if grep -E '^FENGINE_CREDENTIAL_KEY_V1=replace-with' "$env_file" >/dev/null; then
  key="$(openssl rand -base64 32)"
  # Portable in-place replace without GNU sed -i quirks.
  tmp="$(mktemp)"
  awk -v key="$key" '
    /^FENGINE_CREDENTIAL_KEY_V1=replace-with/ { print "FENGINE_CREDENTIAL_KEY_V1=" key; next }
    { print }
  ' "$env_file" >"$tmp"
  mv "$tmp" "$env_file"
  echo "Generated FENGINE_CREDENTIAL_KEY_V1 in deploy/vps/.env"
fi

needs_config=0
if grep -E '^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_ISSUER|SUPABASE_JWKS_URL)=.*(YOUR_PROJECT|example\.supabase|replace-with)' "$env_file" >/dev/null; then
  needs_config=1
fi
if grep -E '^FENGINE_ALLOWED_USER_IDS=11111111-1111-4111-8111-111111111111$' "$env_file" >/dev/null; then
  needs_config=1
fi

if [[ "$needs_config" -eq 1 ]]; then
  cat >&2 <<'EOF'

Edit deploy/vps/.env before F-Motion can start:

  1. Supabase (free project you own)
       VITE_SUPABASE_URL
       VITE_SUPABASE_ANON_KEY
       SUPABASE_ISSUER
       SUPABASE_JWKS_URL

  2. Exactly ONE owner UUID from Supabase Auth → Users → copy user id
       FENGINE_ALLOWED_USER_IDS=<that-uuid>

  3. Optional on a real VPS: change POSTGRES_PASSWORD and MINIO_ROOT_PASSWORD
       Set FENGINE_WEB_ORIGIN and R2_PUBLIC_ENDPOINT to your public URLs

Then run again:

  ./install.sh

EOF
  exit 1
fi

chmod +x "$root/scripts/vps-up.sh"
exec bash "$root/scripts/vps-up.sh"
