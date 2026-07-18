# CLAUDE.md — PhysioBook Master Prompt

> **Every agent working on this repo reads this file first.**

---

## 1. What this project is

**PhysioBook** is an appointment-booking app for a **single solo physiotherapist** (a portfolio project). Patients book hourly slots; the physiotherapist (admin) manages availability, time-off, and workload.

**The real goal is engineering discipline, not features:**

1. **Full test coverage** — unit, integration, and E2E.
2. **Automated CI/CD** — the full suite runs on every change.
3. **Tests from day one** — no feature merges without its tests.
4. **Correctness under concurrency** — the double-booking race is won inside PostgreSQL, never in application code.

If a change would improve a feature but weaken any of these four goals, it is wrong. Say so.

---

## 2. Stack (do not substitute without being asked)

| Area       | Choice                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| Frontend   | React + Vite + TypeScript                                                                 |
| Backend    | Node + Fastify + TypeScript                                                               |
| ORM / DB   | Drizzle ORM + PostgreSQL                                                                  |
| Auth       | JWT (roles: `user`, `admin`)                                                              |
| Validation | Zod schemas in `shared/` (the API contract)                                               |
| Jobs       | pg-boss (Postgres-backed; no Redis)                                                       |
| Email      | Provider in prod, **Mailpit** in dev/test                                                 |
| Tests      | Vitest, Fastify `.inject()`, Testcontainers (Postgres), React Testing Library, Playwright |
| CI/CD      | GitHub Actions                                                                            |

TypeScript is **strict** everywhere. No new dependency lands without a reason recorded in the PR.

---

## 3. Repository layout (monorepo, pnpm workspaces)

```
physiobook/
├── frontend/   React + Vite client
├── backend/    Fastify API + pg-boss worker
├── db/         Drizzle schema, migrations, seeds  (source of truth for the data model)
├── shared/     Zod schemas + inferred types       (the API contract, imported by both sides)
├── e2e/        Playwright cross-package tests
├── docker/     Dockerfiles + postgres/init.sql (enables btree_gist)
├── docker-compose.yml        postgres · mailpit · backend · frontend
├── tsconfig.base.json        strict options every package extends
└── .github/workflows/ci.yml  lint → typecheck → unit/integration → e2e → coverage
```

**Boundary rules:**

- The **API contract lives in `shared/`.** Backend validates requests with these Zod schemas; frontend imports the inferred types. Never define a request/response shape twice.
- The **data model lives in `db/`.** Both backend and the test harness import schema and the Drizzle client from here. Never redefine tables elsewhere.
- Packages talk only through explicit dependencies. No reaching into another package's internals.

Full detail: `PROJECT_STRUCTURE.md`.

---

## 4. Domain rules (the source of truth for behaviour)

- **Slots** are fixed **1-hour blocks on the hour**, only within the admin's configured business hours and not blocked by time-off.
- **Anti-double-booking** is enforced by a PostgreSQL `EXCLUDE` constraint (`btree_gist` over a `tstzrange`) on a single occupancy ledger (`calendar_blocks`) holding both appointments and time-off. **Never** solve booking conflicts with check-then-insert application logic.
- **Notifications:** email, **24h before**, to both user and admin; consecutive admin appointments collapse into **one grouped** message. Scheduled via pg-boss; `notification_log.dedupe_key` guarantees exactly-once.
- **Cancellation:** users cannot cancel within 24h; admin hard-cancel is unrestricted and notifies the user.
- **Availability:** admin sets business days/hours freely — this defines which slots exist.
- **Timezone:** store all timestamps in **UTC**; render in the practice timezone; handle DST explicitly.
- **Future multi-practitioner:** the `EXCLUDE` constraint is already scoped by `practitioner_id`. Keep it that way; do not un-scope it.

Full detail: `REQUIREMENTS.md` and `SCHEMA.md`. If code and these docs disagree, the docs win — or you flag the discrepancy; you do not silently diverge.

---

## 5. Golden rules for every agent

1. **Tests ship with the code.** A feature PR without its tests is incomplete. No exceptions.
2. **Prove correctness against real Postgres.** Race, overlap, and constraint tests run on Testcontainers/CI service Postgres — never a mock.
3. **Validate at the boundary with the `shared/` Zod schemas.** Trust nothing from the client.
4. **Keep the four goals intact** (§1). Flag any change that risks them.
5. **Small, focused PRs**, one ticket each, with a clear description and the tests that prove it.
6. **Ask when the spec is ambiguous.** Don't invent domain behaviour — surface the question.
7. **No secrets in code.** Everything through validated env (`backend/src/config/env.ts`); update `.env.example` when you add a variable.

---

## 6. Working conventions

- **Branches:** `type/ticket-id-short-desc` (e.g. `feat/3.2-book-appointment`).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `refactor:`).
- **Definition of Done:** acceptance criteria met · tests written and green · lint + typecheck clean · coverage gate passing · docs updated if behaviour changed.
- **Before opening a PR:** run `pnpm -r lint`, `pnpm -r typecheck`, and the test suite locally.

When in doubt, optimise for a codebase that is **obviously correct and fully tested**, not clever.
