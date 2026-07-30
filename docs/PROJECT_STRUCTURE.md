# PhysioBook — Project Structure

**Type:** Monorepo
**Package manager / workspaces:** pnpm workspaces _(decided — pinned via `packageManager`; fast, strict, first-class monorepo support)_
**Optional task runner:** Turborepo _(for cached, parallel `build`/`test`/`lint` across packages — add when the repo grows)_
**Last updated:** 2026-07-29 (E1.2)

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
│   ├── frontend/
│   │   └── nginx.conf        # SPA fallback + cache headers for the built assets
│   └── postgres/
│       └── init.sql          # extensions (btree_gist, citext) on first boot — single source
├── .github/
│   └── workflows/
│       ├── ci.yml            # lint → typecheck → unit/integration → coverage (e2e added in E7)
│       └── docker-smoke.yml  # compose up → healthchecks → btree_gist → down
├── docker-compose.yml        # Postgres + Mailpit + backend + frontend
├── docker-compose.override.yml   # local dev tweaks (hot reload w/ polling, exposed ports); auto-applied
├── .dockerignore             # keeps host node_modules and .env out of build contexts
├── .env.example              # documents every required env var
├── .gitignore
├── .gitattributes            # enforces LF line endings (Windows-safe)
├── .editorconfig             # shared editor settings (LF, indentation)
├── .nvmrc                    # pins Node version (22 LTS)
├── package.json              # workspace root: shared scripts, dev tooling, packageManager pin
├── pnpm-workspace.yaml       # declares the workspace packages
├── tsconfig.base.json        # shared compiler options; packages extend this
├── vitest.config.ts          # composes each package's suite as a Vitest project;
│                             #   owns coverage reporters + the coverage gate
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
│   │   ├── db.ts             # Drizzle client (node-postgres) decorated onto Fastify
│   │   └── error-handler.ts  # every failure → one `{ code, message }` body; 404 handler too
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
│   │   ├── global-setup.ts   # Vitest globalSetup: boot Postgres once → load init.sql → migrate a template
│   │   ├── test-db.ts        # clones that template into a fresh DB per test file
│   │   └── postgres-uri.ts   # retargets a connection URI at another database
│   ├── db/
│   │   ├── extensions.test.ts           # proves init.sql reaches test DBs (btree_gist usable)
│   │   ├── test-database.test.ts        # proves the harness migrates and isolates
│   │   └── users.test.ts                # citext email, single-admin index, updated_at trigger
│   └── race/
│       └── concurrent-booking.test.ts   # the headline race test
├── vitest.config.ts          # what to run; coverage/gate come from the root config
├── tsconfig.json             # extends ../tsconfig.base.json
└── package.json
```

- **Route/service tests** are co-located per module (`*.test.ts`) and use Fastify `.inject()`.
- **DB-backed and race tests** use the Testcontainers harness against a real Postgres — the **same** harness runs locally and in CI (Docker on the runner), so there is no separate CI database path. `global-setup.ts` boots **one** container per run and leaves a **template database** behind (init.sql applied, migrations applied via the `db` package's own runner); `createTestDatabase()` clones it per test file, which costs milliseconds instead of a container boot. Because the setup is unconditional, **any** backend test run needs Docker — including one that only touches unit tests.
- The **auth plugin** does a per-request session lookup so `/auth/logout` (which revokes the session) takes effect immediately, killing even a still-valid 15-min access token.
- **`buildServer()` takes everything it needs as options** (database URL, JWT secret, TTL, clock) and reads no environment itself. `index.ts` parses and validates the environment once via `config/env.ts` and hands the result down; `tests/helpers/test-app.ts` passes a throwaway container and a fixed secret to the **same** builder, so no test exercises a special-cased app.
- **`error-handler.ts` is registered before the routes**, and its first branch handles a thrown non-object. That ordering is load-bearing: `hasZodFastifySchemaValidationErrors` narrows with the `in` operator, which raises a `TypeError` on a primitive — and a `TypeError` raised inside an error handler is not caught by it, so Fastify would answer in its own default shape with an internal message attached.
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
│   │   └── index.ts          # re-exports all tables (what drizzle.config.ts reads)
│   ├── client.ts             # creates the Drizzle client (node-postgres) from a connection string
│   ├── migrate.ts            # migration runner: `db:migrate` CLI + runMigrations() for the test harness
│   ├── env.ts                # DATABASE_URL resolution — for the CLI scripts only
│   ├── seed.ts               # dev/demo seed data (stub at first; grows per ticket)
│   └── index.ts              # package barrel: schema + client + migration runner
├── migrations/               # generated SQL migrations (Drizzle Kit) + meta/_journal.json
├── dist/                     # built output, git-ignored — see "Two entrypoints" below
├── drizzle.config.ts         # Drizzle Kit config (schema path, out dir, dialect, casing)
├── tsconfig.json
├── tsconfig.build.json       # emit config (dist/ + declarations)
└── package.json              # scripts: build, db:generate, db:migrate, db:seed
```

- `backend` and the test harness both import the Drizzle client and schema from this package — one source of truth for the data model.
- **Two entrypoints, one source (added E1.2, applies equally to `shared/`).** Both packages are consumed as raw TypeScript during development and as compiled JavaScript in production, via conditional `exports`:

  ```jsonc
  "exports": { ".": {
    "types":       "./src/index.ts",   // tsc — typecheck without a build
    "development": "./src/index.ts",   // Vitest + tsx — no build in the inner loop
    "default":     "./dist/index.js",  // node dist/index.js in the runtime image
  } }
  ```

  The production image has no TypeScript loader, so a bare `import from '@physiobook/db'` resolving to a `.ts` file dies at boot with `ERR_UNKNOWN_FILE_EXTENSION`. The `default` branch is what fixes that; the other two are what stop the fix from costing a build step on every test run — and what keeps coverage measuring `src/`, not `dist/`. Consequences worth not rediscovering:

  - `backend/vitest.config.ts` sets `resolve.conditions: ['development']`, and the backend's `dev` script passes `--conditions development` to tsx. **The flag must come after `watch`** (`tsx watch --conditions development src/index.ts`) — put it first and tsx takes `watch` for the entry filename.
  - `docker/backend.Dockerfile` builds with `pnpm --filter @physiobook/backend... build` (the `...` pulls in both dependencies) and copies each package's `dist/` **and** its `package.json` into the runtime stage. pnpm links these packages as symlinks, so a directory holding only a manifest resolves to an entrypoint that is not there.
  - `dist/` is git-ignored. Nothing in the repo reads it except the production image.

- **One migration runner, two callers.** `pnpm db:migrate` and the Testcontainers harness both call `runMigrations()`; a test database built by a different code path than production would stop proving anything about production the first time the two drifted. Root passthroughs (`pnpm db:generate` / `db:migrate` / `db:seed`) run in this package.
- **Column naming is `casing: 'snake_case'`**, set in _both_ `drizzle.config.ts` (which generates the SQL) and `src/client.ts` (which builds queries at runtime). The two never read one config, and a mismatch surfaces only as a "column does not exist" at query time.
- **`push` is never used** — it mutates a database without leaving a migration behind, so the schema in git would stop describing what is deployed.
- **Extensions** (`btree_gist` for the overlap `EXCLUDE` constraint, `citext` for case-insensitive email) are enabled **only** in `docker/postgres/init.sql`. That single file is loaded by both the compose Postgres and the Testcontainers helper; **no migration enables an extension**.
- A reusable `set_updated_at()` trigger function is created once — in `0001_users_updated_at_and_admin.sql`, the first migration that needed it; every later table attaches its own trigger to that same function to keep `updated_at` current at the database level.
- **Hand-written migrations** (the trigger, the ledger's `EXCLUDE` constraint, data migrations) are generated with `drizzle-kit generate --custom`, so they sit in the journal alongside the diffed ones. The migrator splits a file on the literal `statement-breakpoint` marker and nothing else, so a dollar-quoted function body is safe — but the marker must never appear in prose, including a comment, or the file is cut there and Postgres is handed the text.
- **Rows an install cannot function without** — currently just the default admin, which no route can create — are inserted by a migration. `seed.ts` is for dev/demo data only, and no test may depend on it.
- **Secrets in a data migration** come from a Postgres run-time parameter, not a literal. `runMigrations()` takes them as options and sets them on its single connection; the `.sql` file reads them with `current_setting(name, true)` and `COALESCE`s to a development default. This is the only channel available, since the migrator executes files verbatim and cannot bind parameters into them. The CLI reads the environment (`ADMIN_PASSWORD_HASH`) and warns when a public default is about to be used; library code still takes everything as arguments.

---

## 6. `shared/` — the API contract

```
shared/
├── src/
│   ├── schemas/              # Zod schemas for requests & responses
│   │   ├── appointment.ts
│   │   ├── availability.ts
│   │   ├── auth.ts           # register/login payloads (password min 8 / max 72 bytes for bcrypt)
│   │   └── error.ts          # the one error body: { code, message, details? } + the closed code list
│   ├── types/                # types inferred from the schemas
│   └── index.ts
├── dist/                     # built output, git-ignored (see §5, "Two entrypoints")
├── tsconfig.json
├── tsconfig.build.json
└── package.json
```

- Backend validates incoming requests with these schemas; frontend imports the inferred types **and validates forms with the same schemas**. Define once, consumed both sides.
- **Field naming is `snake_case` across the whole contract** (`full_name`, `created_at`). The registration payload the API accepts is `full_name`, so responses match rather than switching convention halfway through — a form schema and the response type it populates must not disagree about a field's name. Drizzle's camelCase rows stop at the service boundary, which maps them onto these shapes field by field.
- **This package must compile for the browser as well as Node**, so its `lib` is `ES2023` and nothing more. No `TextEncoder`, no `Buffer`, no DOM — `auth.ts` counts UTF-8 bytes by hand for exactly this reason.
- Requests are validated with `z.strictObject`, so an unknown field is a 400 rather than something silently dropped. That is what makes a client-supplied `role` visible instead of merely ineffective.
- **Known deviation from the E1.2 ticket (flagged, not silent — CLAUDE.md §4).** That ticket's acceptance criteria say a client-supplied `role` is _ignored_, i.e. `{ …, role: 'admin' }` still returns 201. `strictObject` answers 400 instead. The two rules genuinely conflict: REVIEWER.md §4 and BACKEND_DEV.md §2 require unknown fields to be rejected. Rejection was chosen — no escalation is possible either way, so the AC's intent holds, and the alternative would make every mistyped field across the API silently ignored. If a future ticket wants the literal behaviour, it changes this schema deliberately rather than discovering the difference in a test.

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
- **Prerequisite:** Docker Desktop with the WSL2 backend, and a root `.env` (`cp .env.example .env`). The base file references every variable without a default, so a missing `.env` fails at `up` rather than booting with surprise credentials.

**Two gotchas worth not rediscovering:**

- **Postgres 18 moved its data directory.** The volume mounts at `/var/lib/postgresql`, _not_ `/var/lib/postgresql/data` — the image now keeps data in a major-version subdirectory and refuses to start if it finds the old layout ([docker-library/postgres#1259](https://github.com/docker-library/postgres/pull/1259)).
- **Compose concatenates `ports` across files** rather than replacing them, so the override tags the frontend's list `!override`. Without it the dev service inherits the base file's `:80` mapping too, both mappings claim the same host port, and the container comes up with no published port at all — while its TCP healthcheck still passes, because that probe runs _inside_ the container.

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
1. install      (pnpm store, cached)
2. lint         (eslint)
3. typecheck    (tsc --noEmit across packages)
4. format       (prettier --check)
5. unit + integration tests   (Vitest; Postgres via Testcontainers, Docker on the runner)
6. coverage     (Vitest v8; upload as GitHub artifact + job summary; gate mechanism enforced)
```

- All six stages are **steps in a single job**, not six jobs: steps already stop at the first failure (the fail-fast requirement), and separate jobs would each repeat checkout + install for no benefit at this size.
- The job is named **`verify`**, and the stage list lives in a comment inside the workflow rather than in `name:`. Branch protection matches the required check by that exact string, so a descriptive name would silently detach protection the moment a stage is added (E7's e2e) — with no error reported anywhere.
- **Blocking a PR requires `verify` to be a required status check** on `main`, configured in repo settings — no file in this repo can set it. Until that is ticked, a red run is advisory and the merge button stays green.
- Integration/race/overlap tests provision Postgres with the **same Testcontainers harness** used locally — there is no separate service-container path — so they run identically in CI and on a dev machine. **Docker must be running locally** to run the suite; `ubuntu-latest` provides it on CI.
- Every package's suite runs through the **root `vitest.config.ts` as a Vitest project** (`pnpm test`), not `pnpm -r test`, because the gate needs one coverage number for the whole repo rather than one unmergeable report per package. Packages join the `projects` list as they grow tests.
- **`concurrency`** cancels superseded runs on PR branches; runs on `main` are never cancelled, so every landed commit keeps its own verdict.
- **e2e (Playwright against the docker-compose stack + Mailpit) is added in E7**, not in the 0.3 skeleton.
- The coverage **gate mechanism** lands with the pipeline (placeholder threshold, so the empty scaffold stays green); the **real threshold is set and enforced in ticket 7.4**, keeping the "full coverage" goal enforceable rather than aspirational. The threshold is the `COVERAGE_THRESHOLD` env var — set once in `ci.yml`, read by `vitest.config.ts`, overridable locally (`COVERAGE_THRESHOLD=80 pnpm test:coverage`).
- Coverage is reported with `all: true`, so an untested module shows as a 0% row rather than being omitted — coverage cannot look healthy by virtue of files nobody imported.

---

## 10. Notes / decisions to confirm later

- **Turborepo:** optional and additive — introduce it when build/test times justify caching.
- **Frontend in prod:** for a portfolio, serving the built static assets (via the frontend container or a CDN) is enough; no SSR needed.
- **Post-MVP hardening (deferred by decision):** password-change flow, stateful refresh-token revocation / "log out everywhere", registration rate-limiting, and email verification. Session revocation for the _current_ session (logout) is already instant via the per-request check.
- **Registration rate-limiting is the one item above that E1.2 explicitly did not add**, even though BACKEND_DEV.md §8 asks for rate limits on auth endpoints — it is listed as deferred here. `POST /auth/register` is therefore unthrottled, and bcrypt at cost 12 makes each call ~250 ms of CPU, so it is the cheapest denial-of-service target in the app. Worth doing before anything is exposed publicly.

```

```
