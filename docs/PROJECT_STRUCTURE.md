# PhysioBook — Project Structure

**Type:** Monorepo
**Package manager / workspaces:** pnpm workspaces _(decided — pinned via `packageManager`; fast, strict, first-class monorepo support)_
**Optional task runner:** Turborepo _(for cached, parallel `build`/`test`/`lint` across packages — add when the repo grows)_
**Last updated:** 2026-08-13 (E1.5)

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
├── docker-compose.yml        # Postgres + Mailpit + backend + worker + frontend
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
│   │   ├── availability/     # hours editor, settings form, slot preview + their TanStack Query hooks
│   │   ├── booking/
│   │   └── notifications/
│   ├── lib/
│   │   ├── api-client.ts     # typed fetch layer; attaches Bearer, single-flight 401→refresh→retry
│   │   ├── query-client.ts   # TanStack Query defaults (no retry on a 4xx)
│   │   ├── useUnsavedChangesGuard.ts  # beforeunload prompt while a form is dirty
│   │   └── auth.ts           # in-memory token + session rehydration on load
│   ├── styles/               # global.scss + _tokens.scss; components use *.module.scss
│   └── types/
├── public/
├── tests/
│   └── setup.ts              # RTL + Vitest setup
├── index.html
├── vite.config.ts            # includes Vitest config (test.environment = jsdom); dev watch uses polling; API path proxy
├── tsconfig.json             # extends ../tsconfig.base.json
├── tsconfig.node.json        # vite.config.ts only — Node globals stay out of src/
└── package.json
```

- **Component tests** (Vitest + React Testing Library) are co-located next to components as `*.test.tsx`.
- The API client imports request/response types from `shared`, so the frontend cannot call the backend with the wrong shape.
- **Auth model:** access token held in memory only; the refresh token is an httpOnly cookie. On app load and on any 401, the client silently calls `/auth/refresh` (single-flight) behind an auth-loading gate so guarded routes never flash to `/login`. Unauthenticated → `/login` (return-to preserved); wrong role → redirect to the user's own area (roles are not hierarchical).
- **The API is served from the SPA's own origin, so there is no CORS layer anywhere in this repo (E1.5).** The Vite dev server proxies the API paths in development and `docker/frontend/nginx.conf` does it for the production build; `plugins/cors.ts` in §4's tree was never written and, on this design, never needs to be. Three things follow, all of them load-bearing:
  - **The paths are proxied unrewritten** — `/auth` stays `/auth`, it does not become `/api/auth`. The refresh cookie is scoped `path=/auth` (§4), so the browser sends it back only to a URL that still begins with that. A prefix would put the cookie's path and the client's URL in two files that have to agree, and the failure mode when they stop agreeing is a cookie that is silently never sent — indistinguishable, from the frontend, from a user who is simply logged out.
  - **The path list lives twice, in `vite.config.ts` and `nginx.conf`, and must be changed together.** A feature prefix added to one and not the other is a 404 in exactly one environment. There is no third place to put it: one is a Node config, the other is nginx's own syntax.
  - **The api-client therefore uses relative URLs and no `credentials` mode**, and there is no `VITE_API_URL`. The browser never learns the backend's address, so nothing in the bundle has to be configured per environment. The dev server's upstream is `BACKEND_ORIGIN` — read by `vite.config.ts` in Node, deliberately without a `VITE_` prefix so it cannot reach the bundle.
  - **It also puts a reverse proxy in front of the rate limiter, which `TRUST_PROXY` has to be told about** in any deployment that routes real users this way — see §10 and the note in `.env.example`. The default stays `false`, correct for the directly-published dev stack, rather than being changed to suit an environment this repo does not yet have.
- **Server state goes through TanStack Query (E2.4).** Feature hooks wrap `api-client` calls in queries and mutations; a mutation invalidates what it changed (a business-hours or settings save stales every cached `/slots` range) rather than editing the cache by hand. The whole cache is cleared when the session ends, so one sign-in never shows another's data.
- **The unsaved-changes guard is `beforeunload` only (E2.4).** It covers reload, tab close and leaving the SPA, not navigation inside it: React Router's `useBlocker` needs a data router and `main.tsx` mounts `<BrowserRouter>`. Guarding in-app links means migrating to `createBrowserRouter` first — a deliberate, recorded gap, not an oversight.
- **Vitest for the client is configured in `vite.config.ts`, not a separate file**, unlike the backend: the frontend's test environment needs the same `@vitejs/plugin-react` transform and the same `resolve.conditions` as the dev server, and a second file would be a second copy of both. `resolve.conditions` names `development` so dev, `vite build` and Vitest all read `shared`'s TypeScript source rather than a `dist/` built at some other commit.

---

## 4. `backend/` — Node + Fastify + Drizzle

```
backend/
├── src/
│   ├── server.ts             # builds & configures the Fastify instance
│   ├── index.ts              # boots the server (listen)
│   ├── config/
│   │   └── env.ts            # loads + validates env with Zod (JWT_SECRET, REFRESH_TTL_SECONDS, TRUST_PROXY)
│   ├── plugins/              # Fastify plugins (auth, cookie, rate-limit, cors, error handler)
│   │   ├── auth.ts           # verify access JWT + per-request session revocation check; requireAuth / requireRole
│   │   ├── cookie.ts         # @fastify/cookie + the one definition of the refresh cookie's attributes
│   │   ├── rate-limit.ts     # @fastify/rate-limit, opt-in per route (per address, or per user behind a guard); 429 → the standard error body
│   │   ├── db.ts             # Drizzle client (node-postgres) decorated onto Fastify
│   │   ├── jobs.ts           # starts an enqueue-only pg-boss, decorates `app.jobs` (send)
│   │   └── error-handler.ts  # every failure → one `{ code, message }` body; 404 handler too
│   ├── lib/
│   │   ├── tokens.ts         # shared JWT sign/verify util (sub, role, session_id, exp)
│   │   ├── refresh-token.ts  # mint/parse/hash the opaque refresh cookie value
│   │   ├── session-id.ts     # isSessionId() — the one uuid check both credentials pass
│   │   └── period.ts         # periodStart / periodEnd / tstzrangeOf, shared by slots, time-off and booking
│   ├── modules/              # one folder per domain area
│   │   ├── auth/
│   │   │   ├── auth.routes.ts    # register, login, me, refresh, logout
│   │   │   ├── auth.service.ts   # bcrypt, session create/refresh/revoke, token issue
│   │   │   ├── auth.test.ts      # POST /auth/register
│   │   │   ├── auth.login.test.ts    # POST /auth/login
│   │   │   ├── auth.me.test.ts       # GET  /auth/me
│   │   │   ├── auth.refresh.test.ts  # POST /auth/refresh
│   │   │   ├── auth.logout.test.ts   # POST /auth/logout (incl. the instant-kill proof)
│   │   │   └── auth.service.test.ts  # refreshSession / revokeSession, and register's DB failures
│   │   ├── appointments/
│   │   │   ├── appointments.routes.ts       # POST /appointments, DELETE /appointments/:id (user) · POST /admin/appointments/:id/cancel (admin)
│   │   │   ├── appointments.service.ts      # book: isSlotBookable → 422, then block (ON CONFLICT DO NOTHING) + appointment in one transaction; no row → 409 SLOT_TAKEN · cancel: one conditional UPDATE, miss → 404/403/409/422 · admin hard-cancel: conditional UPDATE + send-cancellation enqueue in one transaction, miss → 404/409/422
│   │   │   ├── appointments.service.test.ts # Testcontainers: taken / time-off / cancelled / other practitioner, 422 cases, rollback; cancel cutoff boundary, ownership, statuses, race
│   │   │   ├── appointments.admin-cancel.service.test.ts # Testcontainers: inside the user cutoff, job enqueued once, started/cancelled/unknown/time-off/other practitioner, failed enqueue rolls back, race
│   │   │   ├── appointment-status.test.ts   # contract status enum == db block_status (runtime + type level)
│   │   │   ├── appointments.test.ts         # inject(): 201/409/422/400/401/403/429, spoofed user_id → 400, slot leaves GET /slots
│   │   │   ├── appointments.cancel.test.ts  # inject() DELETE: 200 (slot back in GET /slots, re-bookable)/422/403/404/409/400/401, admin → 403
│   │   │   └── appointments.admin-cancel.test.ts # inject() admin cancel: 200 + job queued, slot back in GET /slots, 403/401/422/409/404/400
│   │   ├── availability/     # admin business hours + time off
│   │   │   ├── business-hours.routes.ts   # GET (any auth) / PUT (admin) /business-hours
│   │   │   ├── business-hours.service.ts  # whole-week replace: lock → delete → insert, one transaction
│   │   │   ├── business-hours.test.ts     # inject(): validation, roles, no partial write
│   │   │   ├── business-hours.service.test.ts  # DB rollback + concurrent-replace race
│   │   │   ├── slot-grid.ts               # pure: generateSlots, bookingWindow, isSlotBookable (DST-aware, Luxon)
│   │   │   ├── slot-grid.test.ts          # fixed-clock cases, DST days, UTC→local oracle across zones
│   │   │   ├── slot-grid.property.test.ts # fast-check invariants of the grid
│   │   │   ├── slots.service.ts           # settings + hours + active blocks → bookable slots
│   │   │   ├── slots.service.test.ts      # Testcontainers: block kinds/statuses, practitioner scope, clock
│   │   │   ├── slots.routes.ts            # GET /slots (any auth)
│   │   │   ├── slots.test.ts              # inject(): range cap, validation, auth
│   │   │   ├── time-off.service.ts        # create (ON CONFLICT DO NOTHING, 409 lists conflicts) / cancel (one conditional UPDATE)
│   │   │   ├── time-off.service.test.ts   # Testcontainers: overlap kinds, statuses, scope, clock, create + cancel races
│   │   │   ├── time-off.routes.ts         # POST /time-off, DELETE /time-off/:id (admin)
│   │   │   └── time-off.test.ts           # inject(): 201/409/422/400/403/401, 204/404/409/422, slots hidden and freed
│   │   ├── practitioner/
│   │   │   └── practitioner.service.ts  # findPractitionerId() — the single admin (slots + booking)
│   │   ├── dashboard/        # workload aggregation
│   │   └── notifications/    # schedules pg-boss jobs
│   ├── worker.ts             # worker process entrypoint: validated env → runWorker(startWorker)
│   ├── jobs/
│   │   ├── boss.ts           # shared pg-boss config: queue names, createBoss/startBoss, JobQueue
│   │   ├── worker.ts         # startWorker(): handlers + tiny /health; runWorker(): signal → drain → exit code
│   │   ├── noop.job.ts       # 4.1's no-op handler, proves enqueue → consume
│   │   ├── send-cancellation.job.ts # payload schema { appointmentId } + placeholder handler (4.4 sends the mail)
│   │   └── reminders.job.ts  # 24h reminder logic (incl. admin grouping)
│   └── lib/
│       ├── mailer.ts         # nodemailer SMTP transport (provider in prod, Mailpit in dev/test); rejects on failure so jobs retry
│       ├── mail-template.ts  # defineTemplate(): {subject, text, html} from one set of paragraphs, HTML-escaped
│       └── errors.ts         # typed domain errors → HTTP responses
├── tests/
│   ├── helpers/
│   │   ├── test-app.ts       # builds Fastify app for `.inject()`
│   │   ├── global-setup.ts   # Vitest globalSetup: boot Postgres once (durability off) → load init.sql → migrate a template; boot Mailpit alongside
│   │   ├── mailpit.ts        # Mailpit HTTP API client: uniqueRecipient(), findMessages(), waitForMessage()
│   │   ├── test-db.ts        # clones that template into a fresh DB per test file
│   │   └── postgres-uri.ts   # retargets a connection URI at another database
│   ├── db/
│   │   ├── extensions.test.ts           # proves init.sql reaches test DBs (btree_gist usable)
│   │   ├── test-database.test.ts        # proves the harness migrates and isolates
│   │   ├── users.test.ts                # citext email, single-admin index, updated_at trigger
│   │   ├── sessions.test.ts             # FK cascade, NOT NULL expiry, revocation stamp
│   │   └── business-hours.test.ts       # day_of_week range + closes_after_opens CHECKs
│   ├── jobs/
│   │   ├── boss.test.ts                 # schema created on start, queues, API + worker co-start
│   │   ├── worker.test.ts               # exactly-once no-op, /health, graceful drain
│   │   ├── transaction-db.test.ts       # a job sent through a Drizzle tx commits / rolls back with it
│   │   └── api-enqueue.test.ts          # app.jobs.send → worker consumes it exactly once
│   ├── mail/
│   │   ├── mailpit-harness.test.ts      # the inbox helper finds mail by recipient, and only that
│   │   └── mailer.test.ts               # templated mail over SMTP lands in Mailpit; unreachable SMTP rejects
│   └── race/
│       ├── concurrent-booking.test.ts   # the headline race test (3.3): 20 patients / one patient ×20 → one booking, 10×
│       └── concurrent-time-off.test.ts  # time off ×20, and time off vs 20 bookings → one block, never a 500
├── vitest.config.ts          # what to run; coverage/gate come from the root config
├── tsconfig.json             # extends ../tsconfig.base.json
└── package.json
```

- **Route/service tests** are co-located per module (`*.test.ts`) and use Fastify `.inject()`.
- **DB-backed and race tests** use the Testcontainers harness against a real Postgres — the **same** harness runs locally and in CI (Docker on the runner), so there is no separate CI database path. `global-setup.ts` boots **one** container per run and leaves a **template database** behind (init.sql applied, migrations applied via the `db` package's own runner); `createTestDatabase()` clones it per test file, which costs milliseconds instead of a container boot. Because the setup is unconditional, **any** backend test run needs Docker — including one that only touches unit tests. The container runs with **`fsync`, `synchronous_commit` and `full_page_writes` off** (4.1): every `DROP DATABASE` forces and waits for a checkpoint, and with durability on, a checkpoint under parallel coverage runs outlasted the 10 s hook timeout. Constraint, locking and isolation semantics — what the suite proves — are unaffected; only crash safety of a throwaway container is given up.
- **Mail tests** (4.2) read from **one Mailpit container per run**, booted by `global-setup.ts` next to Postgres (same image pin as compose) and reached through `tests/helpers/mailpit.ts`. The inbox is shared by every test file, so a test never clears it: it sends to an address from `uniqueRecipient()` and asserts only on that address. **Only the worker sends mail** — `MAIL_*` is validated in the worker env, never the API's — because mail is slow work and belongs in a job.
- The **auth plugin** does a per-request session lookup so `/auth/logout` (which revokes the session) takes effect immediately, killing even a still-valid 15-min access token.
- **The guards are `requireAuth` and `requireRole(...roles)` (E1.4)**, decorated onto the instance by `plugins/auth.ts` and applied per route as an **`onRequest`** hook. Six decisions worth not re-deriving:
  - **`onRequest`, not `preHandler` — the ordering is load-bearing.** `preHandler` runs _after_ body parsing and schema validation, so an anonymous caller posting a malformed body to a guarded route is answered `400 VALIDATION_FAILED` with the field names and shape of a contract it was never authenticated to see, and never reaches the 401 the ticket requires. The guards read only `request.headers.authorization`, so they need nothing the parsing stage produces — which is why `@fastify/jwt` puts the same check at `onRequest` too. Copy `onRequest:` when guarding a new route; the sample route in the test suite carries a body schema specifically so this cannot silently regress.
  - **`requireRole` authenticates on its own.** It runs the same verify-and-load step and then checks the role, so a guarded route names exactly one guard and there is no way to write a role check that runs on an unauthenticated request. Listing both (`[app.requireAuth, app.requireRole('admin')]`) stays correct: authentication is skipped once `request.user` is set.
  - **Roles are a set, never a ladder.** `requireRole('user')` rejects an admin with 403. Admin routes name `'admin'`; routes both may reach name both. Nothing anywhere grants a role by implication — the frontend's redirect rule (§3) is the same statement on the other side.
  - **The role comes from the signed claim, not a re-read of `users.role`.** We signed the token, so the claim is as trustworthy as the signature; the session row is re-read per request because _revocation_ is what has to be instant, and a role has no such requirement while no route can change one. The day a role-mutation path lands, this becomes a join in the same query — not a second one.
  - **`request.user` is `AuthenticatedUser | null`**, decorated as `null` for every request, because it genuinely is null on every unguarded route. Handlers behind a guard call `authenticatedUser(request)` to narrow it, so no route reads an identity the type system has not shown it has.
  - **One 401 body for every way authentication fails** — absent header, wrong scheme, bad signature, expired token, unknown, revoked or expired session all answer `{ code: "UNAUTHORIZED", message: "Authentication required" }`. Distinguishing them would tell a prober which half of a stolen credential is still good. `INVALID_CREDENTIALS` stays separate: it is login's answer about a password, not the plugin's about a token.
  - **Every 401 carries `WWW-Authenticate: Bearer`**, added in the error handler's domain-error branch for any 401 status, because RFC 9110 §15.5.2 requires a 401 to name the scheme the client should retry with. It is deliberately bare: RFC 6750 also defines an `error="invalid_token"` parameter, and populating it would move the very distinction the single body exists to deny out of the body and into a header. A 403 carries no such header — it is a refusal, not a challenge.
- **A session id is shape-checked before it reaches the database, by `lib/session-id.ts` on both paths.** A non-uuid compared against a `uuid` column raises Postgres `22P02`, which would turn "no such session" into a 500; the check keeps the answer 401, where it belongs. Two callers need it for different reasons and it is one function so they cannot drift: the auth plugin reads a `session_id` claim a forged token cannot reach — the signature is verified first — while `parseRefreshToken` reads the first half of a cookie, which is whatever the client typed and has no signature in front of it at all.
- **The guards are also proven on sample routes attached inside `plugins/auth.test.ts`**, which is where they were proven before any endpoint used them. `POST /auth/logout` (E1.6) is the first shipped route to carry one; the samples stay, because they cover the shapes no real route has yet — `requireRole` with each role, the two composed, and a guarded route with a body schema that would regress the `onRequest` ordering above. One sample is registered through the Zod type provider with a response schema, so the guard is shown to compose with typed routes rather than only with bare ones.
- **`/auth/refresh` and `/auth/logout` split the session's two credentials, and neither accepts the other's (E1.6).** Refresh reads only the cookie; logout is guarded by `requireAuth` and reads only the access token. Four decisions behind that:
  - **Logout authenticates with the access token, not the cookie**, so that revocation is asked for by the credential the guard already validates — the same one whose instant death is the point of the feature. The cost is that a caller whose access token has expired must refresh before it can log out, which the frontend's single-flight `401 → refresh → retry` (§3) already does. A logout that also accepted the cookie would be a second authentication path through the same endpoint, with a mismatched pair (token for session A, cookie for session B) to define behaviour for.
  - **Refresh has its own bucket, an order of magnitude wider than login's** (`REFRESH_RATE_LIMIT_MAX`, default 100 in the same `AUTH_RATE_LIMIT_WINDOW_SECONDS`), rather than sharing that bucket or having none. The two halves of that are separate claims. It must not share login's, because every tab refreshes on load, so ten a minute would 429 a normal user behind one address and the frontend's silent-refresh gate would read that as a logout. But it does need one: it is unauthenticated and turns each request into an indexed lookup, and "nothing to brute-force" — the secret is 32 CSPRNG bytes — is an argument about guessing, not about load. Registered with `rateLimitedRoute(max)`, which overrides only the count while keeping the plugin's window and its `429 RATE_LIMITED` body.
  - **Refresh clears the cookie on a 401, and only on a 401.** A cookie that has just been refused is worthless, and leaving it set means the browser resends it on every load. The narrowing matters: clearing on any thrown error would let a transient database fault log a user out for real.
  - **Both are registered in a child scope whose JSON parser tolerates an empty body.** They are the API's first body-less POSTs, and Fastify's default parser answers `400 BAD_REQUEST` to `Content-Type: application/json` with nothing after it — the header an api-client sets on every POST by default. That 400 is neither the 200 nor the 401 the frontend's `401 → refresh → retry` gate branches on, so silent refresh would kill the session with a confusing error instead of a clean logout. The scope is what keeps the tolerance off `/auth/register` and `/auth/login`, which genuinely require a body; inside it, `getDefaultJsonParser` still handles anything non-empty, so malformed JSON is still a 400 — now declared in both response schemas and pinned by a test, rather than being an undeclared path nobody had considered.
  - **The 204 on logout is declared in the response schema as `z.void()`.** The Zod type provider narrows `reply.status()` to the codes the schema lists, so an undeclared 204 is a type error rather than a runtime surprise; `z.void()` is the shape that still permits `.send()` with no argument. A test asserts the body is genuinely empty, so the declaration cannot quietly start serialising a `null`.
- **`GET /auth/me` is the one endpoint that owns the identity shape (E1.5).** It is guarded by `requireAuth`, reads the `users` row named by the validated token, and answers `publicUserSchema` — the same body `/auth/register` and `/auth/login` nest under `user`. It exists because `/auth/refresh` deliberately answers `{ token }` alone (§6), so the frontend's on-load rehydration is `refresh` → `me`: a credential, then an identity. Two consequences:
  - **It re-reads the row rather than unpacking the token**, because `email` and `full_name` are not claims and never will be — putting them there would make every profile edit wait out an access token's TTL. `role` therefore comes from the row here, unlike the guards, which read the claim (see above); no route can change a role, so the two cannot currently disagree.
  - **A missing row answers 401, not 404.** Sessions cascade with their user, so the guard having proved a live session means the only way the row is gone is an account deleted mid-request — a dead credential, which is what 401 says. A 404 would describe the caller's own identity as a resource it had asked for and missed.
- **Refresh does not rotate anything.** It re-signs an access token for the same `session_id` and leaves `token_hash` and `expires_at` untouched, so the 7-day login horizon is absolute rather than sliding — see §10 for what that costs and what would change it.
- **Auth issues tokens from one place (E1.3).** `startSession()` in `auth.service.ts` writes the `sessions` row, signs the access token carrying its `session_id`, and returns the refresh cookie's value; the route sets the cookie and never sees the attributes. Both `/auth/register` and `/auth/login` go through it, so there is no path that mints a token no session backs — see SCHEMA.md §2.2 for why that matters. `POST /auth/login` answers **201**, not 200: it creates a session, and the ticket names the status explicitly.
- **The rate limiter is opt-in per route** (`config: RATE_LIMITED_ROUTE`), registered with `global: false` and before the routes — its `onRoute` hook only sees what is registered after it. Auth endpoints are limited because login costs ~250 ms of bcrypt; reads that are legitimately bursty are not. Keying is by client address only: adding the email to the key would let anyone lock a known address out of its own account. What counts as the client address is a deployment question, answered by `TRUST_PROXY` — see §10.
- **`buildServer()` takes everything it needs as options** (database URL, JWT secret, TTLs, cookie `Secure` flag, rate limit, clock) and reads no environment itself. `secureCookies` and `trustProxy` are options for exactly this reason: "Secure in prod" and "who is in front of us" are environment questions, and `index.ts` answers both from validated env so the builder stays the same one the tests use. `index.ts` parses and validates the environment once via `config/env.ts` and hands the result down; `tests/helpers/test-app.ts` passes a throwaway container and a fixed secret to the **same** builder, so no test exercises a special-cased app.
- **`error-handler.ts` is registered before the routes**, and its first branch handles a thrown non-object. That ordering is load-bearing: `hasZodFastifySchemaValidationErrors` narrows with the `in` operator, which raises a `TypeError` on a primitive — and a `TypeError` raised inside an error handler is not caught by it, so Fastify would answer in its own default shape with an internal message attached.
- The **pg-boss worker** is a separate process (`src/worker.ts` → `jobs/worker.ts`) so notifications run independently of the API — it gets its own service in Docker (ticket 4.1). Decisions worth not re-deriving:
  - **One config module, two roles.** `jobs/boss.ts` builds the instance for both sides so they agree on schema and queue names. The API's role (`plugins/jobs.ts`) only ever sees a `JobQueue` (`send`), never `work`; supervision/maintenance and cron run in the worker alone. pg-boss creates its own `pgboss` schema on `start()` — no Drizzle migration owns it — and every queue in `QUEUES` is created on start by both roles (idempotent).
  - **The worker needs no API secrets.** It loads `loadWorkerEnv()` (`DATABASE_URL`, `WORKER_HEALTH_PORT`/`HOST`), not the API's schema, so `JWT_SECRET` never reaches that container.
  - **`/health` is HTTP-level, not TCP.** It runs `SELECT 1` through pg-boss's own pool and answers 503 when that fails, which a port probe cannot see. Request logging is off on that server; the probe runs every 5 s.
  - **SIGTERM drains.** `close()` is `boss.stop({ graceful: true, timeout: 20s })` (the health server closes in a `finally`), and compose gives the service `stop_grace_period: 30s` so Docker does not SIGKILL mid-drain. Keep the second above the first. `runWorker()` subscribes to SIGTERM/SIGINT **before** boot, so a stop requested mid-start still drains and exits 0 rather than Node's default 143.
  - **Handlers are injected** (`startWorker({ handlers })`), so tests can wrap the real handler and count invocations against a real Postgres.
  - **Enqueue with the change that causes it (E5.2).** A job that must exist exactly when a write commits is sent with `send(name, data, { db: fromDrizzle(tx, sql) })` — pg-boss's own Drizzle adapter, which runs the insert on the transaction, so the job commits or rolls back with it (`tests/jobs/transaction-db.test.ts` proves both). The admin hard-cancel uses it, so a cancel without its notification job cannot exist.

---

## 5. `db/` — schema, migrations, seeds

```
db/
├── src/
│   ├── schema/               # Drizzle table definitions
│   │   ├── users.ts          # uuid pk, citext email, role enum, single-admin partial index
│   │   ├── sessions.ts       # login sessions (id, user_id, token_hash, expires_at, revoked_at) — backs refresh/logout
│   │   ├── appointments.ts   # incl. unique + EXCLUDE (btree_gist) constraints
│   │   ├── business-hours.ts # weekly windows: day_of_week + TIME open/close, per-row CHECKs
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
│   │   ├── appointment.ts    # book request { start } (strict: no user_id), appointment { id, start, end, status }
│   │   ├── business-hours.ts # weekly windows: HH:MM, close > open, no same-day overlap
│   │   ├── auth.ts           # register/login payloads (register: password min 8 / max 72 bytes for bcrypt)
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
- **`refreshResponseSchema` is `{ token }` alone, not `authResponseSchema` (E1.6).** Refresh answers a question about a credential, not about an identity: the caller already knows who it is, and re-sending the user on every silent refresh would make `/auth/me` the second place the same shape is produced. The frontend's on-load rehydration therefore costs a refresh plus a `/auth/me`, which is the right split — one endpoint owns the identity shape. **E1.5 shipped that endpoint** and gave it no schema of its own: it answers `publicUserSchema` directly, since a `meResponseSchema` alias would be a second name for one shape and the first chance for the two to drift.
- **Login does not reuse the registration password schema (E1.3).** `loginRequestSchema` bounds the field but states no policy. Restating the 8–72-byte rule there would answer 400 where the ticket requires one indistinguishable 401 — a short password would then look different from a wrong one — and would lock out any account whose password predates a future tightening.
- **Known deviation from the E1.2 ticket (flagged, not silent — CLAUDE.md §4).** That ticket's acceptance criteria say a client-supplied `role` is _ignored_, i.e. `{ …, role: 'admin' }` still returns 201. `strictObject` answers 400 instead. The two rules genuinely conflict: REVIEWER.md §4 and BACKEND_DEV.md §2 require unknown fields to be rejected. Rejection was chosen — no escalation is possible either way, so the AC's intent holds, and the alternative would make every mistyped field across the API silently ignored. If a future ticket wants the literal behaviour, it changes this schema deliberately rather than discovering the difference in a test.

---

## 7. Docker — one command to start it all

`docker-compose.yml` orchestrates five services:

```
postgres   →  the database (Postgres 18; btree_gist + citext enabled via init.sql)
mailpit    →  catches outbound email in dev; UI for inspecting messages
backend    →  Fastify API (enqueues pg-boss jobs)
worker     →  pg-boss consumer — same image as backend, `node dist/worker.js`; /health for its healthcheck
frontend   →  Vite dev server (dev) / static build served (prod)
```

- **`docker compose up`** boots the whole stack for local development.
- The base `docker-compose.yml` is CI/prod-like; **`docker-compose.override.yml`** layers on dev conveniences (bind-mounts for hot reload, **file-watch polling** so reloads fire from the Windows filesystem, exposed debug ports) and is applied automatically in local runs.
- Each service defines a **TCP/port-level healthcheck** — except the worker, whose probe is HTTP-level (`/health` reports pg-boss connected). The CI smoke test brings the base stack up, waits for those to pass, round-trips a no-op job through the worker and asserts it exits 0 on SIGTERM.
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
- **e2e (Playwright against the docker-compose stack + Mailpit) is added in E7**, not in the 0.3 skeleton. Stories that shipped before the harness existed and therefore owe E7 their E2E cases are listed in **`DEFERRED_TESTS.md`** — that file is E7's worklist, and a deferred case with no entry there is a process failure, not a scheduling one.
- The coverage **gate mechanism** lands with the pipeline (placeholder threshold, so the empty scaffold stays green); the **real threshold is set and enforced in ticket 7.4**, keeping the "full coverage" goal enforceable rather than aspirational. The threshold is the `COVERAGE_THRESHOLD` env var — set once in `ci.yml`, read by `vitest.config.ts`, overridable locally (`COVERAGE_THRESHOLD=80 pnpm test:coverage`).
- Coverage is reported with `all: true`, so an untested module shows as a 0% row rather than being omitted — coverage cannot look healthy by virtue of files nobody imported.

---

## 10. Notes / decisions to confirm later

- **Turborepo:** optional and additive — introduce it when build/test times justify caching.
- **Frontend in prod:** for a portfolio, serving the built static assets (via the frontend container or a CDN) is enough; no SSR needed.
- **Post-MVP hardening (deferred by decision):** password-change flow, "log out everywhere", and email verification. Session revocation for the _current_ session is no longer a claim about the design but a tested property (E1.6): `POST /auth/logout` stamps `revoked_at`, and the per-request check in the auth plugin refuses the still-unexpired access token on the very next request.
- **Auth rate-limiting landed in E1.3**, closing what §10 previously recorded as deferred: `/auth/login` and `/auth/register` are limited per route, per client address, by `AUTH_RATE_LIMIT_MAX` in `AUTH_RATE_LIMIT_WINDOW_SECONDS` (10/minute by default). **E1.6 added `/auth/refresh` on its own `REFRESH_RATE_LIMIT_MAX` (100/minute)** — see §4 for why it is bounded but not bounded at login's number. `/auth/logout` is left unlimited: it is behind the guard, and the only session it can revoke is the caller's own, once. **E3.2 put `POST /appointments` on its own `BOOKING_RATE_LIMIT_MAX` (20/minute), keyed by the authenticated user rather than the address** — booking runs no bcrypt, and patients behind one NAT must not share a bucket — so the address caveat below does not apply to it. Two things bound how much any of this is worth, both configuration rather than code:
  - **"Client address" means whatever `TRUST_PROXY` says it means.** Unset, it is the socket address — correct only when the app is reached directly. Put nginx, Traefik, or a load balancer in front without setting it and every request resolves to the proxy, the entire practice shares one bucket, and one noisy client locks the real user out — the control inverted into the denial of service it was added to prevent. `TRUST_PROXY` takes a hop count or a list of trusted proxy addresses; it **rejects `true`**, which would take the leftmost `X-Forwarded-For` entry — written by the client — and let an attacker present a fresh identity per request.
    - **E1.5 made that hypothetical real and it is now settled in configuration.** The SPA reaches `/auth` through the frontend origin, so nginx (and the Vite dev server, via `xfwd`) is in front of every auth request: `TRUST_PROXY=1`. A hop count trusts the header on _every_ route in, so the base stack **publishes no backend port** — the proxy is the only way in, which is what makes the forwarded address trustworthy. The dev override republishes it for debugging and accepts that trade knowingly. Change one of those three and the other two must change with it. That the limiter then buckets by the forwarded client rather than the proxy is covered by `backend/src/modules/auth/auth.login.test.ts`.
  - **The store is in-memory, per process**, so N replicas mean N× the limit. Fine for one container; a shared store is the fix if the API is ever scaled out.
- **Refresh-token rotation is still not implemented, now deliberately rather than by absence (E1.6).** `POST /auth/refresh` re-signs an access token and leaves the cookie and the `sessions` row exactly as they were, so a stolen cookie works until logout or the 7-day expiry, and `expires_at` is an absolute horizon rather than a sliding one — a login lasts a week no matter how actively it is used. Rotating on each refresh, and treating a replayed old secret as a compromise signal worth revoking the whole session over, is the upgrade; it needs the reuse-detection story, not just a new `token_hash`, which is why it is not smuggled in here. The E1.6 ticket says "no rotation needed" and this is that decision written down.
- **The refresh cookie has no signing secret, and E1.6 did not add one** even though its ticket asks for "refresh secret + TTL" in `config/env.ts`. The TTL (`REFRESH_TTL_SECONDS`) has existed since E1.3; the secret has nothing to sign, because the cookie is an opaque random value verified against `sessions.token_hash` rather than a JWT — see SCHEMA.md §2.2. Adding the variable would have put a key in `.env.example` that no code reads. Flagged rather than silently skipped, per CLAUDE.md §4.

```

```
