# PhysioBook

An appointment-booking app for a solo physiotherapist. Patients book one-hour slots; the physiotherapist (admin) manages business hours, time-off and their workload.

It's a portfolio project, and the real goal is engineering discipline rather than features:

- **Full test coverage**: unit, integration and end-to-end.
- **Automated CI/CD**: the whole suite runs on every change.
- **Tests from day one**: no feature merges without its tests.
- **Correct under concurrency**: double-booking is prevented by PostgreSQL itself, not by application code.

## How it works

- **Slots** are fixed one-hour blocks on the hour, inside the admin's business hours and outside any time-off.
- **No double-booking.** Appointments and time-off share a single table (`calendar_blocks`). A PostgreSQL `EXCLUDE` constraint on that table makes overlapping entries impossible, even when two requests arrive at the same moment.
- **Reminders** go out by email 24 hours before each appointment, to both patient and admin. Consecutive admin appointments are grouped into one message.
- **Cancellation:** patients can't cancel within 24 hours of an appointment. The admin can cancel at any time, and the patient is notified.
- **Time** is stored in UTC and shown in the practice's timezone, with daylight-saving changes handled explicitly.

## Tech stack

| Area     | Choice                                                          |
| -------- | --------------------------------------------------------------- |
| Frontend | React, Vite, TypeScript                                         |
| Backend  | Node, Fastify, TypeScript                                       |
| Database | PostgreSQL 18, Drizzle ORM                                      |
| Contract | Zod schemas shared by frontend and backend                      |
| Jobs     | pg-boss (runs on Postgres, so no Redis)                         |
| Email    | Mailpit in dev/test                                             |
| Tests    | Vitest, Testcontainers, React Testing Library, Playwright       |
| CI       | GitHub Actions                                                  |

## Repository layout

```
frontend/   React client
backend/    Fastify API and pg-boss worker
db/         Drizzle schema, migrations and seeds (the data model)
shared/     Zod schemas and types (the API contract)
e2e/        Playwright tests that span packages
docker/     Dockerfiles and Postgres init script
docs/       Backlog, schema and structure docs
agents/     Role guides for backend, frontend and review work
```

## Getting started

**You'll need** Node 22.14.0 (see `.nvmrc`), pnpm and Docker Desktop (WSL2 backend on Windows).

```bash
pnpm install
cp .env.example .env        # local credentials and ports
docker compose up           # postgres, mailpit, backend, worker, frontend
```

Once it's running:

| Service     | URL                                   |
| ----------- | ------------------------------------- |
| Frontend    | http://localhost:5173                 |
| Backend API | http://localhost:3000                 |
| Mailpit     | http://localhost:8025 (captured email) |

Ports come from `.env`, so change them there if they clash.

### Common commands

```bash
pnpm test             # unit + integration tests (starts a real Postgres via Testcontainers)
pnpm test:coverage    # same, with a coverage report
pnpm lint             # ESLint
pnpm typecheck        # TypeScript, strict
pnpm format           # Prettier
pnpm db:migrate       # apply migrations
pnpm db:seed          # load seed data
```

Integration tests need Docker running, because they run against real PostgreSQL rather than mocks.

## Project status

The MVP is being built in epics tracked in [`docs/BACKLOG.csv`](docs/BACKLOG.csv). Setup, auth, availability and booking are complete. Notifications and admin tools are almost done. The patient panel and the end-to-end hardening pass are still to come.

## Further reading

| Document | What's in it |
| -------- | ------------ |
| [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) | Detailed tour of each package, Docker setup, tooling and the CI pipeline |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Database design, including how the anti-double-booking constraint works |
| [`docs/BACKLOG.csv`](docs/BACKLOG.csv) | The plan of record: every ticket with acceptance criteria, tests and status |
| [`docs/DEFERRED_TESTS.md`](docs/DEFERRED_TESTS.md) | Test cases postponed to later tickets, and what already covers them |
| [`docs/PROJECT_MANAGER.md`](docs/PROJECT_MANAGER.md) | How the backlog is planned and kept in sync with the code |
| [`agents/BACKEND_DEV.md`](agents/BACKEND_DEV.md) | Backend conventions: layering, validation, concurrency, jobs, testing |
| [`agents/FRONTEND_DEV.md`](agents/FRONTEND_DEV.md) | Frontend conventions: structure, data fetching, booking UX, accessibility |
| [`agents/REVIEWER.md`](agents/REVIEWER.md) | Code-review rules every pull request must pass |
| [`CLAUDE.md`](CLAUDE.md) | Project rules for AI agents working on the repo |

## Contributing

- Branches follow `type/ticket-id-short-desc`, for example `feat/3.2-book-appointment`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:` and so on).
- Each pull request covers one ticket and ships with its tests. Lint, typecheck and the test suite must pass before it opens.
