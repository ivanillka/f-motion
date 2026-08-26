#!/usr/bin/env bash
# One-image self-host: Postgres + MinIO + API + worker + Caddy.
set -euo pipefail

DATA="${FMOTION_DATA:-/data}"
mkdir -p "$DATA/postgres" "$DATA/minio" "$DATA/secrets"

export FENGINE_ENV="${FENGINE_ENV:-selfhost}"
export FMOTION_ENV="${FMOTION_ENV:-selfhost}"
export NODE_ENV=production
unset FENGINE_LOCAL_AUTH || true
unset FENGINE_BOOTSTRAP_TOKEN || true
unset FMOTION_BOOTSTRAP_TOKEN || true

credential_key_file="$DATA/secrets/credential-key"
if [[ ! -s "$credential_key_file" ]]; then
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))" > "$credential_key_file"
fi
export FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION="${FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION:-1}"
export FENGINE_CREDENTIAL_KEY_V1="${FENGINE_CREDENTIAL_KEY_V1:-$(cat "$credential_key_file")}"
export FENGINE_PEXELS_BYOK_ENABLED="${FENGINE_PEXELS_BYOK_ENABLED:-1}"
export FENGINE_PIXABAY_BYOK_ENABLED="${FENGINE_PIXABAY_BYOK_ENABLED:-1}"
export FENGINE_FAL_BYOK_ENABLED="${FENGINE_FAL_BYOK_ENABLED:-1}"

export POSTGRES_USER="${POSTGRES_USER:-fmotion}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-fmotion}"
export POSTGRES_DB="${POSTGRES_DB:-fmotion}"
export PGDATA="$DATA/postgres"
export PGHOST="${PGHOST:-/tmp}"
# Debian packages keep initdb/postgres in the versioned libdir, not PATH.
PG_BIN="$(echo /usr/lib/postgresql/*/bin)"
if [[ ! -x "$PG_BIN/initdb" || ! -x "$PG_BIN/postgres" ]]; then
  echo "postgres binaries not found under /usr/lib/postgresql" >&2
  exit 1
fi
pg() {
  runuser -u postgres -- env PATH="$PG_BIN:/usr/bin:/bin" "$@"
}

if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
  chown -R postgres:postgres "$DATA/postgres"
  pg initdb -D "$PGDATA" --auth-local=trust --auth-host=trust
fi
chown -R postgres:postgres "$DATA/postgres"
pg postgres -D "$PGDATA" -k /tmp -h 127.0.0.1 -p 5432 &
for _ in $(seq 1 60); do
  if pg pg_isready -h /tmp -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
pg pg_isready -h /tmp -p 5432
pg psql -h /tmp -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='$POSTGRES_USER'" | grep -q 1 \
  || pg psql -h /tmp -d postgres -c "CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';"
pg psql -h /tmp -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='$POSTGRES_DB'" | grep -q 1 \
  || pg psql -h /tmp -d postgres -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"

export MINIO_ROOT_USER="${R2_ACCESS_KEY_ID:-fmotion}"
export MINIO_ROOT_PASSWORD="${R2_SECRET_ACCESS_KEY:-fmotion-local-secret}"
minio server "$DATA/minio" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 &
for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:9000/minio/health/live >/dev/null; then
    break
  fi
  sleep 1
done
mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "local/${R2_BUCKET:-fmotion-local}" >/dev/null

export DATABASE_URL="${DATABASE_URL:-postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:5432/$POSTGRES_DB}"
export QUEUE_DATABASE_URL="${QUEUE_DATABASE_URL:-$DATABASE_URL}"
export R2_ENDPOINT="${R2_ENDPOINT:-http://127.0.0.1:9000}"
export R2_BUCKET="${R2_BUCKET:-fmotion-local}"
export R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-fmotion}"
export R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-fmotion-local-secret}"
export FENGINE_ACCESS_MODE="${FENGINE_ACCESS_MODE:-provision_verified}"
export FENGINE_PEXELS_BYOK_ENABLED="${FENGINE_PEXELS_BYOK_ENABLED:-0}"
export FENGINE_PIXABAY_BYOK_ENABLED="${FENGINE_PIXABAY_BYOK_ENABLED:-0}"
export FENGINE_FAL_BYOK_ENABLED="${FENGINE_FAL_BYOK_ENABLED:-0}"
export PORT="${PORT:-3000}"

cd /repo
# Prisma's npx/checkpoint path phones home and hangs when the host has no egress.
export CHECKPOINT_DISABLE=1
export PRISMA_HIDE_UPDATE_MESSAGE=1
export PRISMA_SCHEMA_ENGINE_BINARY="$(echo /repo/node_modules/@prisma/engines/schema-engine-*)"
export PRISMA_QUERY_ENGINE_LIBRARY="$(echo /repo/node_modules/@prisma/engines/libquery_engine-*.so.node)"
if [[ ! -x "$PRISMA_SCHEMA_ENGINE_BINARY" ]]; then
  echo "prisma schema engine not found" >&2
  exit 1
fi
/repo/node_modules/.bin/prisma migrate deploy --schema /repo/prisma/schema.prisma
node apps/api/dist/start.js &
node apps/worker/dist/start.js &

for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${PORT}/readyz" >/dev/null; then
    break
  fi
  sleep 1
done

exec caddy run --config /repo/deploy/Caddyfile --adapter caddyfile
