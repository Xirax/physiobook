# syntax=docker/dockerfile:1.7
#
# Backend image — Fastify API (and, from E6, the pg-boss worker).
# Build context is the REPO ROOT, not backend/: pnpm needs the workspace root
# manifests and the single lockfile to resolve a workspace install.

# --- base: toolchain shared by every stage ------------------------------------
FROM node:22.14.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack activates the exact pnpm version pinned in the root package.json's
# `packageManager` field, so image builds and dev machines use the same one.
RUN corepack enable
WORKDIR /app

# --- manifests: the layer that decides whether install re-runs ----------------
# Copied on their own so a source-only edit reuses the cached install below.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY backend/package.json ./backend/
COPY db/package.json ./db/
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/
COPY e2e/package.json ./e2e/

# --- deps: full install (dev deps included) — used to build and by dev --------
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @physiobook/backend...

# --- dev: hot-reload target for docker-compose.override.yml -------------------
# No source is COPYed: the override bind-mounts the working tree over /app so
# edits on the host are what tsx watches.
FROM deps AS dev
ENV NODE_ENV=development
WORKDIR /app/backend
CMD ["pnpm", "dev"]

# --- build: compile TypeScript to dist/ ---------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY db ./db
COPY shared ./shared
COPY backend ./backend
# `...` builds the workspace dependencies too, in topological order. Both are
# required, not incidental: db/ and shared/ resolve to their TypeScript source
# through the `development` export condition, which nothing sets here — so plain
# `node dist/index.js` follows `default` to their dist/, and would die with
# ERR_UNKNOWN_FILE_EXTENSION on a .ts file if these were left unbuilt.
RUN pnpm --filter @physiobook/backend... build

# --- prod-deps: runtime dependencies only -------------------------------------
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @physiobook/backend...

# --- runtime: slim final image ------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/

# The two workspace packages the backend imports at runtime. `prod-deps` links
# them into node_modules as symlinks to /app/db and /app/shared, so those
# directories have to exist here with the manifest that maps the package name to
# an entrypoint AND the dist/ that entrypoint names — a symlink to a directory
# holding only a package.json resolves to a file that is not there.
#
# Each one's own node_modules comes too, and is not optional. pnpm does not hoist
# to the root: `shared`'s dependency on zod lives at shared/node_modules/zod as a
# symlink into the root .pnpm store. Node resolves a bare specifier by walking up
# from the *importing* file, so shared/dist/schemas/auth.js looks in
# shared/node_modules and then /app/node_modules — and finds zod in neither if
# this is skipped, failing at boot with ERR_MODULE_NOT_FOUND. That the backend
# also depends on zod does not help: backend/node_modules is not on that path.
#
# Only dist/, the manifest and node_modules: src/ would ship TypeScript to
# production that nothing loads, and db/migrations is applied by
# `pnpm db:migrate`, never by the API process.
COPY --from=build /app/db/dist ./db/dist
COPY --from=prod-deps /app/db/node_modules ./db/node_modules
COPY db/package.json ./db/
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=prod-deps /app/shared/node_modules ./shared/node_modules
COPY shared/package.json ./shared/

# The node image ships an unprivileged `node` user; running as root in a
# container that serves HTTP has no upside.
USER node
WORKDIR /app/backend

# Deliberately no EXPOSE: the listening port is BACKEND_PORT, set by compose,
# and a hardcoded number here would be a second source of truth that silently
# goes stale. EXPOSE is documentation only — it publishes nothing.
CMD ["node", "dist/index.js"]
