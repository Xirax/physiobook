# PhysioBook — Database Schema Sketch

**Engine:** PostgreSQL
**ORM:** Drizzle (schema in `db/src/schema/`, constraints in hand-written migrations where noted)
**Last updated:** 2026-07-21

---

## 1. The central design decision: one occupancy ledger

The hardest correctness requirement — _nothing may overlap anything_ (no double-booked slot, no appointment over time-off, no time-off over an appointment) — is best solved by putting **both appointments and time-off into a single table of time ranges** and letting one Postgres constraint enforce mutual exclusion.

That table is **`calendar_blocks`**. It carries a `period` (`tstzrange`) and a single **`EXCLUDE`** constraint that forbids any two _active_ blocks from overlapping. Because this is a database-level constraint, it holds under full concurrency — the race is won or lost inside Postgres, not in application code.

Appointment-specific data (which user, status history) lives in an **`appointments`** table that references its block. This keeps the ledger clean while preserving domain detail.

> **Alternative considered:** separate `appointments` and `time_off` tables with a `SERIALIZABLE` transaction checking both on insert. It works, but pushes correctness into application logic and retry handling. The single-ledger + `EXCLUDE` approach is stronger and simpler to prove in tests — so it's the recommendation.

---

## 2. Tables

### 2.1 `users`

| Column          | Type             | Notes                              |
| --------------- | ---------------- | ---------------------------------- |
| `id`            | `uuid` PK        | `default gen_random_uuid()`        |
| `email`         | `citext`         | **unique**, case-insensitive       |
| `password_hash` | `text`           | bcrypt/argon2 hash                 |
| `role`          | `user_role` enum | `'user' \| 'admin'` (single admin) |
| `full_name`     | `text`           |                                    |
| `created_at`    | `timestamptz`    | `default now()`                    |
| `updated_at`    | `timestamptz`    | `default now()`                    |

- Enum `user_role = ('user','admin')`.
- `email` is `citext`, so uniqueness is case-insensitive **in the database** — `Alex@x.com` and `alex@x.com` cannot both exist, whether or not a caller normalised the address.
- **Single-admin invariant is a partial unique index**, not app logic: `CREATE UNIQUE INDEX users_single_admin_idx ON users (role) WHERE role = 'admin'`. Counting admins before inserting is the same check-then-insert race the ledger refuses elsewhere (CLAUDE.md §4), so the index is the arbiter. Ordinary users are unconstrained by it.
- `updated_at` is maintained by a `BEFORE UPDATE` trigger on the shared `set_updated_at()` function, so it is correct for every writer including hand-typed SQL.
- The **default admin** (`admin@physiobook.local`) is inserted by a **data migration**, not by `db:seed`: there is no admin-registration route, so an install without it cannot grow one. The committed password hash is a local-development default to be replaced after the first deploy.

---

### 2.2 `practice_settings` (singleton)

Holds the practitioner-wide configuration so business rules are data, not magic numbers.

| Column                      | Type          | Notes                                                           |
| --------------------------- | ------------- | --------------------------------------------------------------- |
| `id`                        | `smallint` PK | pinned to `1`; `CHECK (id = 1)` keeps it a singleton            |
| `timezone`                  | `text`        | IANA name, e.g. `'Europe/Warsaw'` — canonical practice timezone |
| `slot_duration_minutes`     | `integer`     | default `60`                                                    |
| `reminder_lead_hours`       | `integer`     | default `24`                                                    |
| `cancellation_cutoff_hours` | `integer`     | default `24`                                                    |

- All timestamps are stored in **UTC**; this `timezone` is used to interpret business hours and to render times.

---

### 2.3 `business_hours`

Weekly recurring availability. The admin edits these freely; they define which slots _can_ exist.

| Column        | Type       | Notes                                                       |
| ------------- | ---------- | ----------------------------------------------------------- |
| `id`          | `uuid` PK  |                                                             |
| `day_of_week` | `smallint` | `0`–`6` (0 = Sunday); `CHECK (day_of_week BETWEEN 0 AND 6)` |
| `opens_at`    | `time`     | wall-clock, interpreted in `practice_settings.timezone`     |
| `closes_at`   | `time`     | `CHECK (closes_at > opens_at)`                              |

- Multiple rows per day allow split shifts (e.g. 09:00–13:00 and 15:00–18:00).
- Not a hard DB constraint on bookings — the API validates that a requested slot falls inside an open window. (Enforcing it purely in the DB would over-complicate the schema; it's covered by service logic + tests.)

---

### 2.4 `calendar_blocks` — the occupancy ledger ⭐

Every reserved piece of time — a patient appointment **or** an admin time-off — is a row here.

| Column       | Type                | Notes                                                          |
| ------------ | ------------------- | -------------------------------------------------------------- |
| `id`         | `uuid` PK           |                                                                |
| `kind`       | `block_kind` enum   | `'appointment' \| 'time_off'`                                  |
| `period`     | `tstzrange`         | `[start, end)`; for appointments `end = start + slot_duration` |
| `status`     | `block_status` enum | `'active' \| 'cancelled'` (default `'active'`)                 |
| `created_at` | `timestamptz`       | `default now()`                                                |
| `updated_at` | `timestamptz`       | `default now()`                                                |

**Constraints (hand-written migration — Drizzle emits the table, these are added via raw SQL):**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- No two ACTIVE blocks may overlap. This single line enforces:
--   • no double-booked appointment slot
--   • no appointment overlapping time-off
--   • no time-off overlapping an appointment
ALTER TABLE calendar_blocks
  ADD CONSTRAINT calendar_blocks_no_overlap
  EXCLUDE USING gist (period WITH &&)
  WHERE (status = 'active');

-- Appointments sit on the top of the hour and are exactly one slot long.
ALTER TABLE calendar_blocks
  ADD CONSTRAINT appt_on_the_hour
  CHECK (
    kind <> 'appointment'
    OR (
      date_trunc('hour', lower(period)) = lower(period)
      AND upper(period) = lower(period) + interval '1 hour'
    )
  );
```

- The `WHERE (status = 'active')` clause means a **cancelled** block frees its time immediately — a new booking for the same slot succeeds.
- `time_off` blocks may be any length ("admin blocks time as he likes"); only appointments are constrained to on-the-hour, one-slot ranges.

---

### 2.5 `appointments`

Domain detail for patient bookings. One-to-one with an `appointment`-kind block.

| Column         | Type                      | Notes                                                      |
| -------------- | ------------------------- | ---------------------------------------------------------- |
| `id`           | `uuid` PK                 |                                                            |
| `block_id`     | `uuid`                    | **FK → `calendar_blocks.id`**, unique, `ON DELETE CASCADE` |
| `user_id`      | `uuid`                    | **FK → `users.id`**                                        |
| `status`       | `appointment_status` enum | `'booked' \| 'cancelled_by_user' \| 'cancelled_by_admin'`  |
| `cancelled_at` | `timestamptz`             | nullable                                                   |
| `created_at`   | `timestamptz`             | `default now()`                                            |

- `block_id` is **unique** → exactly one appointment per block.
- Cancelling an appointment sets its `status` here **and** flips the linked block to `status = 'active' → 'cancelled'`, releasing the slot.
- Convenience: appointment start/end read from the joined block's `period` (single source of truth — no duplicated timestamps to drift).

---

### 2.6 `notification_log`

Audit + idempotency for the 24h reminders (so a job retry can't double-send).

| Column              | Type             | Notes                                                                      |
| ------------------- | ---------------- | -------------------------------------------------------------------------- |
| `id`                | `uuid` PK        |                                                                            |
| `recipient_role`    | `user_role` enum | `'user'` or `'admin'`                                                      |
| `recipient_user_id` | `uuid`           | FK → `users.id`, nullable (admin grouped mail may be practice-wide)        |
| `type`              | `text`           | e.g. `'reminder_user'`, `'reminder_admin_grouped'`, `'cancelled_by_admin'` |
| `dedupe_key`        | `text`           | **unique**; e.g. `reminder_user:{appointmentId}`                           |
| `sent_at`           | `timestamptz`    | `default now()`                                                            |
| `payload`           | `jsonb`          | what was sent (for debugging/tests)                                        |

- The `dedupe_key` unique constraint is what makes reminders exactly-once even if pg-boss retries.

> **pg-boss** creates and manages its own job tables (in a `pgboss` schema) automatically — we don't model those. `notification_log` is _our_ record of what actually went out.

---

## 3. Relationships (overview)

```
users ────────< appointments >──── (1:1) ──── calendar_blocks
  │                                                  ▲
  │                                                  │  (time_off rows have no appointment)
  └──< notification_log                              │
                                                     │
practice_settings (singleton)      business_hours ───┘ (defines which slots are offerable)
```

---

## 4. How each MVP rule maps to the schema

| Rule                                               | Enforced by                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Can't book a taken slot / **race**                 | `EXCLUDE` constraint on `calendar_blocks.period` (DB-level, concurrency-safe)                         |
| Appointments are hourly, on the hour               | `appt_on_the_hour` CHECK                                                                              |
| Admin time-off can't overlap existing appointments | same `EXCLUDE` constraint (insert of the time-off block fails)                                        |
| Cancel frees the slot                              | flip block `status` to `'cancelled'`; partial index excludes it                                       |
| No user cancel within 24h                          | service logic vs `cancellation_cutoff_hours`; DB has no time-of-day awareness                         |
| 24h reminders (user + admin, grouped)              | pg-boss job scheduled at `start − reminder_lead_hours`; `notification_log.dedupe_key` guarantees once |
| Admin sets business days/hours                     | `business_hours` rows                                                                                 |
| Workload dashboard                                 | aggregate query over `calendar_blocks` within `business_hours`                                        |
| Nearest-appointment countdown                      | `SELECT min(lower(period)) … WHERE user_id = ? AND status active AND lower(period) > now()`           |
| Roles (JWT)                                        | `users.role`; verified in the Fastify auth plugin                                                     |

---

## 5. Indexes

- `calendar_blocks`: the GiST index backing the `EXCLUDE` constraint covers range queries; add `btree (status)` and `gist (period)` is implicit via the constraint. A partial index `(lower(period)) WHERE status='active'` speeds "upcoming" lookups.
- `appointments`: `btree (user_id)`, unique `(block_id)`.
- `users`: unique `(email)` (case-insensitive via `citext`), plus the partial unique `(role) WHERE role = 'admin'`.
- `notification_log`: unique `(dedupe_key)`.

---

## 6. Drizzle implementation notes

- Drizzle's schema builder covers the tables, columns, enums, FKs, CHECKs, and plain unique/btree indexes.
- **`tstzrange`, the `btree_gist` extension, and the `EXCLUDE` constraint** are not first-class in Drizzle's builder — put them in a **hand-written SQL migration** (Drizzle Kit supports custom migrations). This is expected and clean; the constraint is the crown jewel, so owning its SQL explicitly is a feature, not a workaround.
- Represent `period` in TypeScript via a small custom type / helpers (`lower`/`upper`) rather than fighting the ORM.

---

## 7. Test hooks this schema enables

- **Race test:** N parallel inserts of the same appointment block → exactly one commits, others hit `calendar_blocks_no_overlap`. Asserted against real Postgres (Testcontainers).
- **Overlap test:** admin time-off spanning an existing appointment → insert rejected by the same constraint.
- **Cancellation-releases-slot test:** cancel → re-book same slot succeeds (partial-index `WHERE status='active'` behaviour).
- **Idempotent reminder test:** run the reminder job twice → one `notification_log` row, one email in Mailpit.

---

## 8. Future: multi-practitioner

MVP ships with a single admin/practitioner, but moving to multiple practitioners should be an **additive migration, not a rewrite**. The only piece that is painful to change after the fact is the overlap constraint, so we hedge that one thing now and leave everything else for later.

**Do now (cheap hedge, ~one column + one clause):**

- Add a `practitioners` concept — either a `practitioners` table, or treat the single admin `users` row as practitioner #1.
- Add a `practitioner_id` column to the three **scoping** tables — `calendar_blocks`, `business_hours`, `appointments` — all defaulting to that one practitioner.
- Make the overlap constraint **scoped to the practitioner** from day one, so overlap is forbidden only within the same practitioner (Dr. A at 10:00 must not block Dr. B at 10:00):

```sql
ALTER TABLE calendar_blocks
  ADD CONSTRAINT calendar_blocks_no_overlap
  EXCLUDE USING gist (practitioner_id WITH =, period WITH &&)
  WHERE (status = 'active');
```

`btree_gist` supports this composite form directly. Adding the column now avoids the one genuinely annoying later migration: rewriting a live overlap constraint and backfilling a scope column.

**Defer until actually needed (naturally additive):**

- **Auth/roles:** add a `practitioner` role or a practitioner↔user link.
- **Queries:** dashboard, appointments, and availability gain a `WHERE practitioner_id = ?` filter.
- **UI:** add a practitioner picker to the booking flow.
- **Settings:** split `practice_settings` into practice-wide vs per-practitioner rows.
- **Single-admin invariant:** drop the `UNIQUE (role) WHERE role = 'admin'` index.

**Unaffected:** patients (`users`) stay shared across all practitioners.

---

## 9. Open questions for later

1. Should `time_off` support a reason/label the admin can see on the dashboard? (Cheap to add: a nullable `note` on `calendar_blocks`.)
2. Do we keep cancelled appointments forever for history, or soft-archive after N months? (Affects dashboard queries, not the MVP.)
