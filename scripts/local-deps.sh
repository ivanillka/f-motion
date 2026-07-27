#!/usr/bin/env bash
# Start disposable Postgres 17 + MinIO for the durable local stack (matches CI images).
set -euo pipefail

postgres_container="${FMOTION_POSTGRES_CONTAINER:-fmotion-postgres}"
minio_container="${FMOTION_MINIO_CONTAINER:-fmotion-minio}"

if ! docker container inspect "$postgres_container" >/dev/null 2>&1; then
  docker run -d --name "$postgres_container" \
    -e POSTGRES_USER=fmotion \
    -e POSTGRES_PASSWORD=fmotion \
    -e POSTGRES_DB=fmotion \
    -p 5432:5432 \
    postgres:17-alpine
fi

if ! docker container inspect "$minio_container" >/dev/null 2>&1; then
  docker run -d --name "$minio_container" \
    -e MINIO_ROOT_USER=fmotion \
    -e MINIO_ROOT_PASSWORD=fmotion-local-secret \
    -p 9000:9000 \
    minio/minio server /data
fi

until docker exec "$postgres_container" pg_isready -U fmotion -d fmotion >/dev/null; do sleep 1; done
until curl --fail --silent http://127.0.0.1:9000/minio/health/live >/dev/null; do sleep 1; done

docker run --rm --network "container:$minio_container" minio/mc \
  alias set local http://127.0.0.1:9000 fmotion fmotion-local-secret >/dev/null
docker run --rm --network "container:$minio_container" minio/mc \
  mb --ignore-existing local/fmotion-local >/dev/null

echo "PostgreSQL and MinIO are ready (bucket fmotion-local)."
