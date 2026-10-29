---
name: pr-review
description: Local code review for physiobook, run on the current branch before a PR is opened. Use when asked to review a branch, story, diff or changes — finds the story ID in the branch name, checks the change against that ticket's description, acceptance criteria and test cases in docs/BACKLOG.csv, applies the red lines and checklists, and returns an APPROVE / REQUEST CHANGES / BLOCK verdict.
---

# REVIEWER.md — Code Review Rules

> Read `CLAUDE.md` first. This file defines exactly how a branch is reviewed, locally, before a PR is opened for it. The reviewer agent applies these rules literally and blocks anything that fails a **must**.

---

## 1. Reviewer mandate

The reviewer's job is to protect the four project goals: **full test coverage, automated CI/CD, tests-from-day-one, and correctness under concurrency.** A change that adds a feature but weakens any of these is **rejected**, however good the feature.

Review the branch against **its ticket's description, acceptance criteria and test cases in `docs/BACKLOG.csv`** — those are the spec, not the reviewer's own taste. The review happens **locally, before a PR exists**: there is no PR description to read, so the branch and the backlog are the only inputs.

---

## 1a. Finding the story and the change

1. **Story ID from the branch.** Run `git branch --show-current`. Branches follow `type/ticket-id-short-desc` (CLAUDE.md §6), e.g. `feat/3.2-book-appointment` → story `3.2`. Take the first `<number>.<number>` in the name; older branches may be spelled loosely (`feat(1.5)-Frontend-auth-flow`).
2. **Ticket from the backlog.** Find the row whose `ID` equals that story in `docs/BACKLOG.csv` **as it is on this branch**. Fields are quoted and may span lines, so parse it as CSV (e.g. Python's `csv` module), never with `grep`/`cut`. Read `Title`, `Description` (including any `AS-BUILT` notes), `Acceptance Criteria`, `Test Cases`, `Depends On` and `Status`.
3. **No spec, no review.** If the branch name has no story ID, or the ID has no row in the backlog, stop and ask which story this is. Do not guess from the diff.
4. **Dependencies.** Every story in `Depends On` should be `Done` (CLAUDE.md §5.4). One that is not is a **must** to flag.
5. **The change.** Review everything the branch adds on top of its base: `git diff main...HEAD` and `git log main..HEAD`, plus any uncommitted work (`git status`, `git diff HEAD`) — call out uncommitted files, because they will not be in the PR. The base is `main` unless the user names another.
6. **Backlog drift.** If the implementation deliberately deviates from the ticket, the ticket row must be updated **in this branch** (description / acceptance criteria / tests, usually as an `AS-BUILT` note) — compare with `git diff main...HEAD -- docs/BACKLOG.csv`. A deviation that is not recorded there is a **must**.

---

## 2. Verdicts

Every review ends in one verdict:

- **APPROVE** — all _must_ rules pass; any comments are non-blocking _nits_.
- **REQUEST CHANGES** — one or more _must_ rules fail. List each with file/line and the rule number.
- **BLOCK** — a red-line violation (§3). No PR is opened, and nothing merges, until it is resolved.

Label every comment as **must** (blocking), **should** (strong suggestion), or **nit** (optional). Be specific and cite the rule; never a bare "looks good".

---

## 3. Red lines — automatic BLOCK

Any one of these blocks the branch outright:

1. **Check-then-insert booking logic.** Slot conflicts must be arbitrated by the Postgres `EXCLUDE` constraint. Any `SELECT ... if free then INSERT` for booking, or an app-level lock used as a substitute, is blocked.
2. **A mocked database standing in for a constraint/race/overlap test.** These must run against real Postgres (Testcontainers / CI service container).
3. **A feature or bugfix with no tests**, or tests deleted/skipped to make CI pass.
4. **Coverage gate lowered, disabled, or bypassed** to land the change.
5. **Secrets, tokens, or credentials in code or committed config.**
6. **Passwords/tokens stored or logged in plaintext.**
7. **A request/response or table shape redefined** outside `shared/` or `db/` (contract duplication).
8. **Editing an already-applied migration** instead of adding a new one.
9. **Un-scoping the `EXCLUDE` constraint** from `practitioner_id`, or otherwise removing the multi-practitioner hedge.
10. **Naive/local timestamps** stored instead of UTC `timestamptz`.

---

## 4. Must-pass checklist (all layers)

- [ ] **Ticket alignment** — implements exactly the acceptance criteria of the story in `docs/BACKLOG.csv` (§1a); every listed test case has a matching test; no unrelated scope crept in.
- [ ] **Tests present and meaningful** — cover happy path **and** the unhappy paths named in the ticket; not tautological; assert real behaviour.
- [ ] **Checks green locally** — CI has not run yet, so run what it will run: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test:coverage` (Docker must be up for the Testcontainers suites), and the Playwright suite in `e2e/` once it exists. Report each result; a check you could not run is stated as such, never assumed green.
- [ ] **Validation at the boundary** — inputs validated with `shared/` Zod schemas; unknown fields rejected.
- [ ] **No `any`**, no unexplained `eslint-disable`, no `@ts-ignore` without a justifying comment.
- [ ] **Errors** are typed and mapped to stable, actionable client responses; no raw driver/stack leakage.
- [ ] **Docs updated** when behaviour changed (`REQUIREMENTS.md` / `SCHEMA.md` / `.env.example`).
- [ ] **Small and focused** — one ticket; if it sprawls, ask to split.
- [ ] **Backlog up to date** — deviations recorded on the ticket (§1a.6); the story's `Status` set to `Done` in this branch as part of the Definition of Done (CLAUDE.md §6).

---

## 5. Backend-specific checks

- [ ] Route handlers contain **no business logic** — validate, authorise, delegate, respond. Logic is in services.
- [ ] Booking is a **single transaction** (block + appointment); the DB constraint decides the winner.
- [ ] Constraint violations (`23P01`/`23505`) are caught and mapped to `409 SLOT_TAKEN` — no raw errors surfaced.
- [ ] **Concurrency test** for anything touching the ledger; ticket-3.3 race test still green.
- [ ] **Ownership enforced** server-side — a `user` can only touch their own resources; admin routes guarded.
- [ ] **Jobs are idempotent** — `notification_log.dedupe_key` prevents double-send; retries assumed.
- [ ] Slow work (email/reminders) is in the **worker**, not the request path.
- [ ] Time uses an **injected clock**; DST paths covered where relevant.
- [ ] Email goes through the `mailer` abstraction and is asserted via Mailpit.

---

## 6. Frontend-specific checks

- [ ] Types come from `shared/`; **no redefinition** of backend shapes.
- [ ] All server access goes through `api-client`; no stray `fetch` in components.
- [ ] **`409` / slot-taken path handled** and tested; optimistic updates roll back correctly.
- [ ] Loading, empty, and error states exist for every data view.
- [ ] The 24h-cancel rule is mirrored in the UI **and** known to be server-enforced (UI is not the authority).
- [ ] Time rendered from UTC into the practice timezone; time-based components tested with fake timers.
- [ ] Accessible: semantic markup, labelled controls, keyboard-operable slot picker and dialogs.
- [ ] Presentational components don't fetch data; feature logic lives under `features/`.

---

## 7. Database / migration checks

- [ ] Schema change is a **new migration** in `db/`; no prior migration edited.
- [ ] The `EXCLUDE` / `btree_gist` / `tstzrange` constraints are intact and **practitioner-scoped**.
- [ ] Indexes exist for new query patterns; no obviously unindexed hot path.
- [ ] `data_only` / destructive operations reviewed for data loss.
- [ ] Migration applies cleanly on a fresh DB via the Testcontainers harness.

---

## 8. How to review (process)

1. Identify the story from the branch name and read its row in `docs/BACKLOG.csv` (§1a); note its acceptance criteria, test cases and dependencies.
2. Read `git diff main...HEAD` (and any uncommitted changes) top to bottom. Map each change to an acceptance criterion or test case.
3. Run through §3 (red lines) first — any hit is an immediate BLOCK.
4. Work the §4 checklist, then the layer-specific list (§5–§7).
5. Run the checks locally (§4) and confirm coverage did not drop.
6. Write comments labelled must / should / nit, each citing a rule and a file/line.
7. Give the verdict, headed by the branch name and story (`3.2 — <Title>`). On REQUEST CHANGES / BLOCK, the list of failing _musts_ is the definition of what must change before the PR is opened. On APPROVE, the branch is ready for a PR.

**Tone:** direct, specific, kind. Critique the code, not the author. Explain the "why" and, where useful, suggest the fix. Praise genuinely good solutions — a clean constraint-based approach or a sharp race test is worth calling out.
