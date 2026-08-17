# F-Engine reference worker image. Only the worker runs FFmpeg (see
# docs/runbooks/render-worker.md — the API must never fall back to it).
# Build from the repo root so the npm workspace tree resolves:
#
#   docker build -f apps/worker/Dockerfile -t f-engine-reference-worker .
#
# .dockerignore keeps .env* and node_modules out of the build context.

# FFmpeg 8.1.2 is not packaged by Debian bookworm/trixie apt repos yet
# (bookworm ships 5.1.x, trixie ships 7.1.x as of 2026-07). Pin the static
# BtbN/FFmpeg-Builds "gpl" release build instead — it only links against
# glibc/libgcc, so it drops into bookworm-slim with no extra apt packages.
# Verify README's toolchain version before bumping these ARGs.
FROM debian:bookworm-slim AS ffmpeg
ARG FFMPEG_VERSION=n8.1.2-31-g8c9502e9b0
ARG FFMPEG_RELEASE_TAG=autobuild-2026-07-24-13-32
ARG FFMPEG_SHA256=67b4011d82c67586c3703c81d3c967a837319f75e5e61551f22a91588e440660
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
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/fal-host/package.json packages/fal-host/package.json
COPY packages/reel-engine/package.json packages/reel-engine/package.json
COPY packages/fmotion-cli/package.json packages/fmotion-cli/package.json
COPY packages/fmotion-mcp/package.json packages/fmotion-mcp/package.json
RUN npm ci
COPY packages/contracts packages/contracts
COPY packages/fal-host packages/fal-host
COPY packages/reel-engine packages/reel-engine
COPY apps/worker apps/worker
RUN npm run build --workspace packages/contracts \
 && npm run build --workspace packages/reel-engine \
 && npm run build --workspace packages/fal-host \
 && npm run build --workspace apps/worker

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY certs/supabase-root-2021-ca.crt certs/supabase-root-2021-ca.crt
ENV NODE_EXTRA_CA_CERTS=/repo/certs/supabase-root-2021-ca.crt
COPY --from=ffmpeg /tmp/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /tmp/ffmpeg/ffprobe /usr/local/bin/ffprobe
# ponytail: ships the full workspace node_modules (incl. devDependencies of
# other workspaces) for simplicity. Ceiling: acceptable for a private demo
# image. Upgrade: prune with a workspace-aware `npm ci --omit=dev` pass.
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json package.json
COPY --from=build /repo/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/packages/fal-host/package.json packages/fal-host/package.json
COPY --from=build /repo/packages/fal-host/dist packages/fal-host/dist
COPY --from=build /repo/packages/reel-engine/package.json packages/reel-engine/package.json
COPY --from=build /repo/packages/reel-engine/dist packages/reel-engine/dist
COPY --from=build /repo/apps/worker/package.json apps/worker/package.json
COPY --from=build /repo/apps/worker/dist apps/worker/dist
COPY apps/web/public/music apps/worker/assets/music
USER node
CMD ["node", "apps/worker/dist/start.js"]
