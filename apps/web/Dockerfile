# F-Motion studio static site for one-box VPS installs.
# Build from the repository root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_SUPABASE_URL=... \
#     --build-arg VITE_SUPABASE_ANON_KEY=... \
#     -t f-motion-web .

FROM node:24.15.0-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/reel-engine/package.json packages/reel-engine/package.json
COPY packages/fal-host/package.json packages/fal-host/package.json
COPY packages/fmotion-cli/package.json packages/fmotion-cli/package.json
COPY packages/fmotion-mcp/package.json packages/fmotion-mcp/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci
COPY packages/contracts packages/contracts
COPY packages/reel-engine packages/reel-engine
COPY apps/web apps/web
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_ENABLE_GOOGLE_AUTH
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_ENABLE_GOOGLE_AUTH=$VITE_ENABLE_GOOGLE_AUTH
# Never bake partner/Fotium allowlists or demo auth into the VPS image.
ENV VITE_PARTNER_BRAND_EMAIL= \
    VITE_ALLOW_DEMO_AUTH=
RUN npm run build --workspace packages/contracts \
 && npm run build --workspace packages/reel-engine \
 && npm run build --workspace @f-engine/reference-web

FROM nginx:1.27-alpine
COPY deploy/vps/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
