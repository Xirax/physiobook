# PhysioBook — Project Structure

**Type:** Monorepo
**Package manager / workspaces:** pnpm workspaces _(decided — pinned via `packageManager`; fast, strict, first-class monorepo support)_
**Optional task runner:** Turborepo _(for cached, parallel `build`/`test`/`lint` across packages — add when the repo grows)_
**Last updated:** 2026-07-18

---

## 1. Design principles

- **Clear package boundaries.** `frontend`, `backend`, and `db` each own their config, dependencies, and tests. Nothing reaches across a boundary except through an explicit dependency.
- **A shared contract package.** `shared` holds the Zod schemas and inferred types used by both frontend and backend, so the API contract is defined once and can never silently drift.
- **`db` is its own package.** Drizzle schema, migrations, and seeds live independently because both the backend _and_ the test suite (Testcontainers) depend on them. Keeping it separate stops test/infra code from bleeding into runtime code.
- **Tests live with the code they test.** Unit and integration tests are co-located; only Playwright E2E lives at the root because it spans packages.
- **One command to start everything.** `docker compose up` boots Postgres, Mailpit, backend, and frontend together.

---

## 2. Top-level layout

```
physiobook/
├── frontend/                 # React + Vite + TypeScript (client)
├── backend/                  # Node + Fastify + Drizzle (API server)
├── db/                       # Drizzle schema, migrations, seeds
├── shared/                   # Zod schemas + shared types (the API contract)
├── e2e/                      # Playwright end-to-end tests (cross-package)
├── docker/                   # Dockerfiles + service configs
│   ├── frontend.Dockerfile
│   ├── backend.Dockerfile
│   └── postgres/
│       └── init.sql          # extensions (btree_gist, citext) on first boot — single source
├── .github/
│   └── workflows/
│       └── ci.yml            # lint → typecheck → unit/integration → coverage (e2e added in E7)
├── docker-compose.yml        # Postgres + Mailpit + backend + frontend
├── docker-compose.override.yml   # local dev tweaks (hot reload w/ polling, exposed ports); auto-applied
├── .env.example              # documents every required env var
├── .gitignore
├── .gitattributes            # enforces LF line endings (Windows-safe)
├── .editorconfig             # shared editor settings (LF, indentation)
├── .nvmrc                    # pins Node version (22 LTS)
├── package.json              # workspace root: shared scripts, dev tooling, packageManager pin
├── pnpm-workspace.yaml       # declares the workspace packages
├── tsconfig.base.json        # shared compiler options; packages extend this
├── eslint.config.js          # flat ESLint config, shared
├── .prettierrc
├── REQUIREMENTS.md
└── README.md
```

> **Cross-platform note:** the primary dev host is Windows 11 with Docker Desktop (WSL2 backend). `.gitattributes`/`.editorconfig` force LF so shell scripts and `init.sql` run correctly inside Linux containers, and root scripts are cross-platform (no bash-only one-liners).

---

## 3. `frontend/` — React + Vite + TypeScript

```
frontend/
├── src/
│   ├── main.tsx              # app entry
│   ├── App.tsx
│   ├── routes/               # route-level views
│   │   ├── booking/
│   │   ├── my-appointments/  # user panel + nearest-appointment countdown
│   │   └── admin/            # dashboard, availability, all appointments
│   ├── components/           # reusable presentational components
│   ├── features/             # feature-scoped logic (hooks, state, api calls)
│   │   ├── auth/             # AuthProvider/useAuth, in-memory access token, silent refresh
│   │   ├── booking/
│   │   └── notifications/
│   ├── lib/
│   │   ├── api-client.ts     # typed fetch layer; attaches Bearer, single-flight 401→refresh→retry
│   │   └── auth.ts           # in-memory token + session rehydration on load
│   ├── styles/
│   └── types/
├── public/
├── tests/
│   └── setup.ts              # RTL + Vitest setup
├── index.html
├── vite.config.ts            # includes Vitest config (test.environment = jsdom); dev watch uses polling
├── tsconfig.json             # extends ../tsconfig.base.json
└── package.json
```

- **Component tests** (Vitest + React Testing Library) are co-located next to components as `*.test.tsx`.
- The API client imports request/response types from `shared`, so the frontend cannot call the backend with the wrong shape.
- **Auth model:** access token held in memory only; the refresh token is an httpOnly cookie. On app load and on any 401, the client silently calls `/auth/refresh` (single-flight) behind an auth-loading gate so guarded routes never flash to `/login`. Unauthenticated → `/login` (return-to preserved); wrong role → redirect to the user's own area (roles are not hierarchical).

---

## 4. `backend/` — Node + Fastify + Drizzle

```
backend/
├── src/
│   ├── server.ts             # builds & configures the Fastify instance
│   ├── index.ts              # boots the server (listen)
│   ├── config/
│   │   └── env.ts            # loads + validates env with Zod (incl. JWT_SECRET, JWT_REFRESH_SECRET)
│   ├── plugins/              # Fastify plugins (auth, cookie, cors, error handler)
│   │   ├── auth.ts           # verify access JWT + per-request session revocation check; requireAuth / requireRole
│   │   ├── cookie.ts         # @fastify/cookie (httpOnly refresh cookie)
│   │   └── db.ts             # Drizzle client (node-postgres) decorated onto Fastify
│   ├── lib/
│   │   └── tokens.ts         # shared JWT sign/verify util (sub, role, session_id, exp)
│   ├── modules/              # one folder per domain area
│   │   ├── auth/
│   │   │   ├── auth.routes.ts    # register, login, refresh, logout
│   │   │   ├── auth.service.ts   # bcrypt, session create/revoke, token issue
│   │   │   └── auth.test.ts
│   │   ├── appointments/
│   │   │   ├── appointments.routes.ts
│   │   │   ├── appointments.service.ts      # booking, cancel, race handling
│   │   │   └── appointments.test.ts
│   │   ├── availability/     # admin business hours + time off
│   │   ├── dashboard/        # workload aggregation
│   │   └── notifications/    # schedules pg-boss jobs
│   ├── jobs/
│   │   ├── worker.ts         # pg-boss worker entrypoint
│   │   └── reminders.job.ts  # 24h reminder logic (incl. admin grouping)
│   └── lib/
│       ├── mailer.ts         # email transport (provider in prod, Mailpit in dev/test)
│       └── errors.ts         # typed domain errors → HTTP responses
├── tests/
│   ├── helpers/
│   │   ├── test-app.ts       # builds Fastify app for `.inject()`
│   │   └── test-db.ts        # Testcontainers: boot Postgres once → load init.sql → migrate a template → clone per test
│   └── race/
│       └── concurrent-booking.test.ts   # the headline race test
├── vitest.config.ts
├── tsconfig.json             # extends ../tsconfig.base.json
└── package.json
```

- **Route/service tests** are co-located per module (`*.test.ts`) and use Fastify `.inject()`.
- **DB-backed and race tests** use the `tests/helpers/test-db.ts` Testcontainers harness against a real Postgres — the **same** harness runs locally and in CI (Docker on the runner), so there is no separate CI database path.
- The **auth plugin** does a per-request session lookup so `/auth/logout` (which revokes the session) takes effect immediately, killing even a still-valid 15-min access token.
- The **pg-boss worker** is a separate process (`jobs/worker.ts`) so notifications run independently of the API — it gets its own service in Docker.

---

## 5. `db/` — schema, migrations, seeds

```
db/
├── src/
│   ├── schema/               # Drizzle table definitions
│   │   ├── users.ts          # uuid pk, citext email, role enum, single-admin partial index
│   │   ├── sessions.ts       # login sessions (id, user_id, expires_at, revoked_at) — backs refresh/logout
│   │   ├── appointments.ts   # incl. unique + EXCLUDE (btree_gist) constraints
│   │   ├── availability.ts   # business hours + time off
│   │   └── index.ts          # re-exports all tables
│   ├── client.ts             # creates the Drizzle client (node-postgres) from a connection string
│   └── seed.ts               # dev/demo seed data (stub at first; grows per ticket)
├── migrations/               # generated SQL migrations (Drizzle Kit)
├── drizzle.config.ts         # Drizzle Kit config (schema path, out dir, dialect)
├── tsconfig.json
└── package.json              # scripts: db:generate, db:migrate, db:seed
```

- `backend` and the test harness both import the Drizzle client and schema from this package — one source of truth for the data model.
- **Extensions** (`btree_gist` for the overlap `EXCLUDE` constraint, `citext` for case-insensitive email) are enabled **only** in `docker/postgres/init.sql`. That single file is loaded by both the compose Postgres and the Testcontainers helper; **no migration enables an extension**. At the DB scaffold stage there are zero migrations — the first schema migration is the `users` table.
- A reusable `set_updated_at()` trigger function is created once (in the first migration that needs it); every table attaches its own trigger to keep `updated_at` current at the database level.

---

## 6. `shared/` — the API contract

```
shared/
├── src/
│   ├── schemas/              # Zod schemas for requests & responses
│   │   ├── appointment.ts
│   │   ├── availability.ts
│   │   └── auth.ts           # register/login payloads (password min 8 / max 72 bytes for bcrypt)
│   ├── types/                # types inferred from the schemas
│   └── index.ts
├── tsconfig.json
└── package.json
```

- Backend validates incoming requests with these schemas; frontend imports the inferred types **and validates forms with the same schemas**. Define once, consumed both sides.

---

## 7. Docker — one command to start it all

`docker-compose.yml` orchestrates four services:

```
postgres   →  the database (Postgres 18; btree_gist + citext enabled via init.sql)
mailpit    →  catches outbound email in dev; UI for inspecting messages
backend    →  Fastify API + a separate pg-boss worker process
frontend   →  Vite dev server (dev) / static build served (prod)
```

- **`docker compose up`** boots the whole stack for local development.
- The base `docker-compose.yml` is CI/prod-like; **`docker-compose.override.yml`** layers on dev conveniences (bind-mounts for hot reload, **file-watch polling** so reloads fire from the Windows filesystem, exposed debug ports) and is applied automatically in local runs.
- Each service defines a **TCP/port-level healthcheck**; the CI smoke test brings the base stack up and waits for those to pass.
- Per-service Dockerfiles live in `docker/` as multi-stage builds (deps → build → slim runtime), keeping production images small.
- **Mailpit** means every notification is testable end-to-end without sending real email — the same capture point CI uses (in the E7 e2e stage).
- **Prerequisite:** Docker Desktop with the WSL2 backend.

---

## 8. Tooling & configuration conventions

- **`tsconfig.base.json`** at the root holds strict compiler options (`strict: true`, path aliases). Every package extends it, so settings never drift.
- **ESLint (flat config) + Prettier** are shared from the root and run per package. Root scripts are cross-platform (Windows-safe).
- **`.gitattributes` + `.editorconfig`** force LF line endings so containers and lint/format stay consistent across Windows and Linux.
- **`.env.example`** documents every variable; real `.env` files are git-ignored. `backend/src/config/env.ts` validates them at boot with Zod and fails fast if any are missing. `.env.example` grows as tickets add variables.
- **`.nvmrc`** pins the Node version (22 LTS) for contributors and CI alike; pnpm is pinned via the root `packageManager` field.

---

## 9. CI pipeline (`.github/workflows/ci.yml`)

Runs on every push / PR (`ubuntu-latest`), in order, failing fast:

```
1. install (pnpm store, cached)
2. lint         (eslint)
3. typecheck    (tsc --noEmit across packages)
4. unit + integration tests   (Vitest; Postgres via Testcontainers, Docker on the runner)
5. coverage     (Vitest v8; upload as GitHub artifact + job summary; gate mechanism enforced)
```

- Integration/race/overlap tests provision Postgres with the **same Testcontainers harness** used locally — there is no separate service-container path — so they run identically in CI and on a dev machine.
- **e2e (Playwright against the docker-compose stack + Mailpit) is added in E7**, not in the 0.3 skeleton.
- The coverage **gate mechanism** lands with the pipeline (placeholder threshold, so the empty scaffold stays green); the **real threshold is set and enforced in ticket 7.4**, keeping the "full coverage" goal enforceable rather than aspirational.

---

## 10. Notes / decisions to confirm later

- **Turborepo:** optional and additive — introduce it when build/test times justify caching.
- **Frontend in prod:** for a portfolio, serving the built static assets (via the frontend container or a CDN) is enough; no SSR needed.
- **Post-MVP hardening (deferred by decision):** password-change flow, stateful refresh-token revocation / "log out everywhere", registration rate-limiting, and email verification. Session revocation for the _current_ session (logout) is already instant via the per-request check.

```

```
