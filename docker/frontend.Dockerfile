# syntax=docker/dockerfile:1.7
#
# Frontend image — Vite dev server (dev) / static build behind nginx (prod).
# Build context is the REPO ROOT, not frontend/: see docker/backend.Dockerfile.

# --- base ---------------------------------------------------------------------
FROM node:22.14.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- manifests ----------------------------------------------------------------
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY db/package.json ./db/
COPY shared/package.json ./shared/
COPY e2e/package.json ./e2e/

# --- deps ---------------------------------------------------------------------
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @physiobook/frontend...

# --- dev: hot-reload target for docker-compose.override.yml -------------------
# Source is bind-mounted by the override, not copied.
FROM deps AS dev
ENV NODE_ENV=development
WORKDIR /app/frontend
EXPOSE 5173
CMD ["pnpm", "dev"]

# --- build: emit static assets ------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
# shared/ is copied ahead of need: the frontend imports the contract types from
# it in E1, and Vite would fail on an empty directory. db/ is deliberately
# absent — the client must never reach the data model directly (CLAUDE.md §3).
COPY shared ./shared
COPY frontend ./frontend
RUN pnpm --filter @physiobook/frontend build

# --- runtime: nginx serving the built assets ----------------------------------
FROM nginx:1.30.4-alpine AS runtime
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
