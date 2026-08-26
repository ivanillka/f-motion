# One-image F-Motion self-host: web + API + worker + FFmpeg + Postgres + MinIO + Caddy.
# Build from the repository root:
#
#   docker build -f deploy/Dockerfile -t f-motion .
#
# FFmpeg pin matches apps/api/Dockerfile. The API process never calls FFmpeg.

FROM debian:bookworm-slim AS ffmpeg
ARG FFMPEG_VERSION=n8.1.2-44-g7c533d0f86
ARG FFMPEG_RELEASE_TAG=autobuild-2026-08-16-13-00
ARG FFMPEG_SHA256=17780994c4679806fb227676f66a0af30c6379afc770324829f48f2a379be558
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/ffmpeg
RUN dir="ffmpeg-${FFMPEG_VERSION}-linux64-gpl-8.1" \
 && curl -fsSL -o ffmpeg.tar.xz \
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE_TAG}/${dir}.tar.xz" \
 && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
 && tar -xf ffmpeg.tar.xz "${dir}/bin/ffmpeg" "${dir}/bin/ffprobe" \
 && mv "${dir}/bin/ffmpeg" "${dir}/bin/ffprobe" . \
 && rm -rf ffmpeg.tar.xz "${dir}" \
 && chmod +x ffmpeg ffprobe

FROM node:24.15.0-bookworm-slim AS build
WORKDIR /repo
ENV VITE_SELFHOST_AUTH=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/fal-host/package.json packages/fal-host/package.json
COPY packages/reel-engine/package.json packages/reel-engine/package.json
COPY packages/fmotion-cli/package.json packages/fmotion-cli/package.json
COPY packages/fmotion-mcp/package.json packages/fmotion-mcp/package.json
COPY prisma prisma
RUN npm ci
COPY packages/contracts packages/contracts
COPY packages/fal-host packages/fal-host
COPY packages/reel-engine packages/reel-engine
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY apps/web apps/web
RUN npm run build --workspace packages/contracts \
 && npm run build --workspace packages/reel-engine \
 && npm run build --workspace packages/fal-host \
 && npm run build --workspace apps/api \
 && npm run build --workspace apps/worker \
 && npm run build --workspace apps/web

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl openssl postgresql postgresql-contrib fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ADD https://github.com/caddyserver/caddy/releases/download/v2.10.2/caddy_2.10.2_linux_amd64.tar.gz /tmp/caddy.tar.gz
RUN tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy \
 && rm /tmp/caddy.tar.gz \
 && chmod +x /usr/local/bin/caddy
COPY --from=ffmpeg /tmp/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /tmp/ffmpeg/ffprobe /usr/local/bin/ffprobe
ADD https://dl.min.io/server/minio/release/linux-amd64/minio /usr/local/bin/minio
ADD https://dl.min.io/client/mc/release/linux-amd64/mc /usr/local/bin/mc
RUN chmod +x /usr/local/bin/minio /usr/local/bin/mc
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json package.json
COPY --from=build /repo/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/packages/fal-host/package.json packages/fal-host/package.json
COPY --from=build /repo/packages/fal-host/dist packages/fal-host/dist
COPY --from=build /repo/packages/reel-engine/package.json packages/reel-engine/package.json
COPY --from=build /repo/packages/reel-engine/dist packages/reel-engine/dist
COPY --from=build /repo/prisma prisma
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/worker/package.json apps/worker/package.json
COPY --from=build /repo/apps/worker/dist apps/worker/dist
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY apps/web/public/music apps/worker/assets/music
COPY apps/worker/assets/fonts apps/worker/assets/fonts
COPY deploy/Caddyfile deploy/Caddyfile
COPY deploy/entrypoint.sh deploy/entrypoint.sh
RUN chmod +x /repo/deploy/entrypoint.sh
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/repo/deploy/entrypoint.sh"]
