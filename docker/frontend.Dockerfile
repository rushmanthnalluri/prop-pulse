# syntax=docker/dockerfile:1
# PropPulse frontend image (SPEC §9, ADR-5/ADR-7).
#
# Multi-stage: node:24-alpine builds the Vite + React bundle, nginx:alpine
# serves the static dist/ with SPA fallback (docker/nginx.conf).
#
# Build from the REPO ROOT (context must include frontend/ and docker/):
#
#   docker build -f docker/frontend.Dockerfile \
#     --build-arg VITE_API_URL=http://localhost:8000 \
#     -t proppulse-frontend:latest .
#
# Dependency install pattern (documented in docker/README.md): `npm ci` when
# frontend/package-lock.json exists (reproducible), else `npm install`.
# NOTE: builds verified 2026-08-07 (Docker Server 29.4.0) — smoke evidence in
# reports/DOCKER_SMOKE.md.

# --- Stage 1: build the Vite bundle ---------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Vite inlines VITE_* env vars into the bundle at build time, so the API base
# URL is a build ARG (SPEC §9 default: http://localhost:8000).
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=${VITE_API_URL}

# Install dependencies before copying sources so this layer caches unless the
# manifests change. package-lock.json may not exist yet; the wildcard copy
# tolerates that, and the shell picks npm ci (lock present) or npm install.
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Build context excludes node_modules/ and dist/ via .dockerignore.
COPY frontend/ ./
RUN npm run build

# --- Stage 2: serve the static bundle with nginx ---------------------------
FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
