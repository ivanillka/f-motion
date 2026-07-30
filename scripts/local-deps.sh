#!/usr/bin/env bash
# Start disposable Postgres 17 + MinIO for the durable local stack (matches CI images).
set -euo pipefail

postgres_container="${FENGINE_POSTGRES_CONTAINER:-fengine-postgres}"
minio_container="${FENGINE_MINIO_CONTAINER:-fengine-minio}"

if ! docker container inspect "$postgres_container" >/dev/null 2>&1; then
  docker run -d --name "$postgres_container" \
    -e POSTGRES_USER=fengine \
    -e POSTGRES_PASSWORD=fengine \
    -e POSTGRES_DB=fengine \
    -p 5432:5432 \
    postgres:17-alpine
fi

if ! docker container inspect "$minio_container" >/dev/null 2>&1; then
  docker run -d --name "$minio_container" \
    -e MINIO_ROOT_USER=fengine \
    -e MINIO_ROOT_PASSWORD=fengine-local-secret \
    -p 9000:9000 \
    minio/minio server /data
fi

until docker exec "$postgres_container" pg_isready -U fengine -d fengine >/dev/null; do sleep 1; done
until curl --fail --silent http://127.0.0.1:9000/minio/health/live >/dev/null; do sleep 1; done

docker run --rm --network "container:$minio_container" minio/mc \
  alias set local http://127.0.0.1:9000 fengine fengine-local-secret >/dev/null
docker run --rm --network "container:$minio_container" minio/mc \
  mb --ignore-existing local/fengine-local >/dev/null

echo "PostgreSQL and MinIO are ready (bucket fengine-local)."
