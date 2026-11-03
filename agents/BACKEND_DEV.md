# BACKEND_DEV.md — Backend Agent Guide

> Read `CLAUDE.md` first. This file governs work in `backend/` (and its dependencies on `db/` and `shared/`). These rules override personal preference.

---

## 1. Architecture & layering

Each domain area lives in `backend/src/modules/<area>/` with a strict separation:

- **`*.routes.ts`** — HTTP concern only. Declares the route, attaches the Zod schema, applies auth/role guards, calls a service, maps the result to a response. **No business logic here.**
- **`*.service.ts`** — all business logic and data access (via Drizzle). Pure enough to unit-test; receives its dependencies (db client, mailer, clock) rather than importing singletons where practical.
- **`*.test.ts`** — co-located tests for the module.

Cross-cutting concerns are **Fastify plugins** (`src/plugins/`): `auth` (JWT verify + role guards), `db` (Drizzle client decorated on the instance), error handler, CORS, rate-limit. Register via `fastify-plugin` so decorators are visible app-wide.

**Rule:** a route handler should read like a sentence — validate, authorise, delegate, respond. If it contains a loop or a conditional over domain state, that logic belongs in a service.

---

## 2. Validation & the API contract

- Every request body, params, and querystring is validated with a **Zod schema imported from `shared/`**. Use `fastify-type-provider-zod` so handlers are typed from the schema.
- **Never trust client input.** IDs, timestamps, and roles are re-checked server-side. A user may only act on their own resources unless they are `admin`.
- Response shapes are also defined in `shared/`. Do not return ad-hoc objects that drift from the contract.
- Reject unknown fields; do not silently accept extra input.

---

## 3. Database access (Drizzle + Postgres)

- Import the schema and client from the **`db/` package** — never redefine tables in `backend/`.
- **Correctness lives in the database.** The `EXCLUDE` no-overlap constraint on `calendar_blocks` is the source of truth for "slot is free". Do **not** implement `SELECT ... then INSERT if free` — it is a race and will be rejected in review.
- **Booking is a single transaction:** insert the `calendar_blocks` row and the `appointments` row together; let the DB constraint decide the winner.
- **Translate DB constraint violations into clean domain errors** — never leak a raw driver error to the client. For `calendar_blocks`, insert with `ON CONFLICT DO NOTHING` and treat "no row returned" as `409`: a plain `INSERT` that catches `23P01` **deadlocks** under concurrency (`40P01` → 500, found by the 3.3 race test). Elsewhere, catch the unique violation (`23505`) by constraint name.
- Use transactions for any multi-write operation. Keep them short.
- Schema changes go through **Drizzle migrations** in `db/`. The `tstzrange` / `btree_gist` / `EXCLUDE` bits are hand-written SQL migrations — never edit an already-applied migration; add a new one.

---

## 4. Concurrency — the headline requirement

- Assume every booking endpoint is hit by concurrent requests for the same slot. The **only** acceptable arbiter is the Postgres constraint.
- Do not add application-level locks, in-memory guards, or "check availability first" endpoints as a substitute for the constraint. They give false confidence.
- The race is proven by the ticket-3.3 test firing N concurrent requests against real Postgres. Any change to booking must keep that test green.

---

## 5. Time, dates & timezones

- **Store UTC.** Always `timestamptz`. Never store naive local times.
- Interpret and render using `practice_settings.timezone`.
- Business hours are wall-clock in the practice timezone; convert carefully when generating slots.
- **DST is a first-class test case**, not an afterthought. Slot generation and reminder scheduling must be correct across spring-forward and fall-back.
- Never use `Date.now()` directly in business logic — inject a **clock** so tests can control time.

---

## 6. Background jobs (pg-boss)

- The worker (`src/jobs/worker.ts`) runs as a **separate process/service** from the API. Do not do slow work (email send, reminders) inside a request handler.
- On booking, **schedule** the reminder job for `start − reminder_lead_hours`; skip scheduling if the appointment is inside the window.
- Jobs must be **idempotent.** Use `notification_log.dedupe_key` so a pg-boss retry cannot double-send. Assume every job can run more than once.
- On cancellation, cancel the pending reminder job.

---

## 7. Email

- Send through the `mailer.ts` abstraction only. It resolves to the provider in prod and **Mailpit** in dev/test.
- No email content or recipients hardcoded in services — build from templates + data.
- Every notification path is verified by asserting the message landed in Mailpit.

---

## 8. Auth & security

- JWT verification and `requireRole()` guards live in the auth plugin; apply them at the route level.
- Passwords hashed with argon2 (or bcrypt) — never stored or logged in plaintext.
- Enforce ownership: a `user` can only read/modify their own appointments; admin-only routes are guarded.
- Rate-limit auth and booking endpoints.
- Secrets come from validated env (`config/env.ts`, Zod). Fail fast at boot if a required var is missing. Update `.env.example` when adding one.
- Never log secrets, tokens, or password hashes.

---

## 8a. Comments — write few

Clean code explains itself. A comment is a cost: it is unversioned by the compiler, it rots the moment the code beside it changes, and a wall of them buries the one remark that mattered.

- **Default to none.** Prefer a clearer name, a smaller function, or an extracted constant over a sentence explaining the unclear version.
- **Never narrate the code.** If the comment restates what the line does, delete it.
- **Comment only what the code cannot say:** a non-obvious _why_, a deliberate deviation from a ticket or doc, a workaround for an external bug (with a link), or a correctness invariant a future reader would otherwise "simplify" away.
- **Prose belongs in docs.** Design rationale, trade-offs and decisions go in `PROJECT_STRUCTURE.md`/`SCHEMA.md` or the PR description — not in a header block above every export.
- Tests follow the same rule: a precise `it(...)` name replaces most comments.

---

## 9. Errors & logging

- Use typed domain errors (`lib/errors.ts`) mapped to HTTP status by a central error handler. No leaking stack traces or driver messages to clients.
- Use Fastify's built-in **pino** logger. Log structured context (request id, user id), never sensitive data.
- Client-facing errors are actionable and stable (e.g. `{ code: "SLOT_TAKEN", message: "..." }`), so the frontend can react by `code`.

---

## 10. Testing (non-negotiable)

- **Every route and service ships with tests.** No handler merges untested.
- **API tests** use Fastify `.inject()` (in-process, fast) via the `tests/helpers/test-app.ts` builder.
- **DB, constraint, race, and overlap tests** run against **real Postgres via Testcontainers** (`tests/helpers/test-db.ts`) — never a mocked DB. A mock cannot prove a constraint holds under concurrency.
- **Services** get focused unit tests with injected clock/mailer.
- Test the **unhappy paths**: taken slot, out-of-hours, cross-user access, cancel inside 24h, duplicate email, expired token.
- Keep tests deterministic — control time via the injected clock, not `sleep`.

---

## 11. Definition of Done (backend)

Acceptance criteria met · Zod validation at the boundary · DB constraint (not app logic) enforces conflicts · transaction correctness · jobs idempotent · unhappy paths tested · Testcontainers tests for anything touching the ledger · lint + typecheck clean · coverage gate green · `.env.example` and relevant docs updated.
