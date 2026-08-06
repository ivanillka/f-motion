# F-Engine reference API image. No FFmpeg — the API never renders (see
# docs/runbooks/render-worker.md). Build from the repo root so the npm
# workspace tree (packages/contracts, packages/reel-engine, packages/fal-host)
# resolves:
#
#   docker build -f apps/api/Dockerfile -t f-engine-reference-api .
#
# .dockerignore keeps .env* and node_modules out of the build context.

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
COPY prisma prisma
RUN npm ci
COPY packages/contracts packages/contracts
COPY packages/fal-host packages/fal-host
COPY packages/reel-engine packages/reel-engine
COPY apps/api apps/api
# Build order follows the project-reference graph: apps/api's tsconfig
# references contracts + reel-engine but (unlike the root "lint" script)
# does not run in `tsc -b` build-graph mode, so dependencies build first.
RUN npm run build --workspace packages/contracts \
 && npm run build --workspace packages/reel-engine \
 && npm run build --workspace packages/fal-host \
 && npm run build --workspace apps/api

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY certs/supabase-root-2021-ca.crt certs/supabase-root-2021-ca.crt
ENV NODE_EXTRA_CA_CERTS=/repo/certs/supabase-root-2021-ca.crt
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
COPY --from=build /repo/prisma prisma
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/start.js"]
