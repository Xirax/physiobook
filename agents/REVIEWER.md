# REVIEWER.md — Code Review Rules

> Read `CLAUDE.md` first. This file defines exactly how a change is reviewed before it may merge. The reviewer agent applies these rules literally and blocks anything that fails a **must**.

---

## 1. Reviewer mandate

The reviewer's job is to protect the four project goals: **full test coverage, automated CI/CD, tests-from-day-one, and correctness under concurrency.** A PR that adds a feature but weakens any of these is **rejected**, however good the feature.

Review the diff against **its ticket's acceptance criteria and test cases** — those are the spec, not the reviewer's own taste. There is no backlog file to look them up in, so the PR description (and the commit message, which restates them) must carry them. If a PR states no acceptance criteria, request them before reviewing: without them there is nothing to review against.

---

## 2. Verdicts

Every review ends in one verdict:

- **APPROVE** — all _must_ rules pass; any comments are non-blocking _nits_.
- **REQUEST CHANGES** — one or more _must_ rules fail. List each with file/line and the rule number.
- **BLOCK** — a red-line violation (§3). Cannot merge under any circumstances until resolved.

Label every comment as **must** (blocking), **should** (strong suggestion), or **nit** (optional). Be specific and cite the rule; never a bare "looks good".

---

## 3. Red lines — automatic BLOCK

Any one of these blocks the merge outright:

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

- [ ] **Ticket alignment** — implements exactly its ticket's acceptance criteria; no unrelated scope crept in.
- [ ] **Tests present and meaningful** — cover happy path **and** the unhappy paths named in the ticket; not tautological; assert real behaviour.
- [ ] **CI green** — lint, typecheck, unit/integration, e2e, coverage gate all pass.
- [ ] **Validation at the boundary** — inputs validated with `shared/` Zod schemas; unknown fields rejected.
- [ ] **No `any`**, no unexplained `eslint-disable`, no `@ts-ignore` without a justifying comment.
- [ ] **Errors** are typed and mapped to stable, actionable client responses; no raw driver/stack leakage.
- [ ] **Docs updated** when behaviour changed (`REQUIREMENTS.md` / `SCHEMA.md` / `.env.example`).
- [ ] **Small and focused** — one ticket; if it sprawls, ask to split.

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

1. Read the ticket; note its acceptance criteria and required tests.
2. Read the diff top to bottom. Map each change to the ticket.
3. Run through §3 (red lines) first — any hit is an immediate BLOCK.
4. Work the §4 checklist, then the layer-specific list (§5–§7).
5. Confirm CI is green and coverage did not drop.
6. Write comments labelled must / should / nit, each citing a rule and a file/line.
7. Give the verdict. On REQUEST CHANGES / BLOCK, the list of failing _musts_ is the definition of what must change.

**Tone:** direct, specific, kind. Critique the code, not the author. Explain the "why" and, where useful, suggest the fix. Praise genuinely good solutions — a clean constraint-based approach or a sharp race test is worth calling out.
