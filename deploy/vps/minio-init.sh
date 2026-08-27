#!/bin/sh
# Create the private bucket and browser CORS for the VPS web origin.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "local/${R2_BUCKET}"
mc anonymous set none "local/${R2_BUCKET}"

ORIGIN="${FENGINE_WEB_ORIGIN}"
cat > /tmp/cors.json <<EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["${ORIGIN}"],
      "AllowedMethods": ["GET", "PUT", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF
mc cors set "local/${R2_BUCKET}" /tmp/cors.json
echo "MinIO bucket ${R2_BUCKET} ready for origin ${ORIGIN}."
