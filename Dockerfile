# syntax=docker/dockerfile:1
#
# First Session — static SPA container for Cloud Run.
# Stage 1 builds the Vite app; stage 2 serves the static build with nginx.
#
# The build context must be the repo root (it reads apps/web/):
#   docker build -t first-session-web .
# Cloud Run picks this up automatically via `gcloud run deploy --source .`.

# ---- build stage ----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first so this layer is cached unless the lockfile changes.
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

# Build the app: `tsc -b && vite build` emits static files to /app/dist.
COPY apps/web/ ./
RUN npm run build

# ---- serve stage ----------------------------------------------------------
FROM nginx:1.27-alpine AS serve

# Cloud Run routes traffic to $PORT (default 8080). The official nginx image
# runs envsubst over /etc/nginx/templates/*.template at startup, replacing
# ${PORT} below. nginx's own lowercase runtime vars ($uri) are left untouched.
ENV PORT=8080

COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
# CMD is inherited from the base image: it runs envsubst, then `nginx -g 'daemon off;'`.
