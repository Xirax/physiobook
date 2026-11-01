# PhysioBook — Database Schema Sketch

**Engine:** PostgreSQL
**ORM:** Drizzle (schema in `db/src/schema/`, constraints in hand-written migrations where noted)
**Last updated:** 2026-11-01 (E3.1)

---

## 1. The central design decision: one occupancy ledger

The hardest correctness requirement — _nothing may overlap anything_ (no double-booked slot, no appointment over time-off, no time-off over an appointment) — is best solved by putting **both appointments and time-off into a single table of time ranges** and letting one Postgres constraint enforce mutual exclusion.

That table is **`calendar_blocks`**. It carries a `period` (`tstzrange`) and a single **`EXCLUDE`** constraint that forbids any two _active_ blocks from overlapping. Because this is a database-level constraint, it holds under full concurrency — the race is won or lost inside Postgres, not in application code.

Appointment-specific data (which user, status history) lives in an **`appointments`** table that references its block. This keeps the ledger clean while preserving domain detail.

> **Alternative considered:** separate `appointments` and `time_off` tables with a `SERIALIZABLE` transaction checking both on insert. It works, but pushes correctness into application logic and retry handling. The single-ledger + `EXCLUDE` approach is stronger and simpler to prove in tests — so it's the recommendation.

---

## 2. Tables

### 2.1 `users`

| Column          | Type             | Notes                                            |
| --------------- | ---------------- | ------------------------------------------------ |
| `id`            | `uuid` PK        | `default gen_random_uuid()`                      |
| `email`         | `citext`         | NOT NULL, **unique**, case-insensitive           |
| `password_hash` | `text`           | NOT NULL; bcrypt/argon2 hash                     |
| `role`          | `user_role` enum | NOT NULL, `default 'user'`; `'user' \| 'admin'`  |
| `full_name`     | `text`           | NOT NULL — see below                             |
| `created_at`    | `timestamptz`    | NOT NULL, `default now()`                        |
| `updated_at`    | `timestamptz`    | NOT NULL, `default now()`; maintained by trigger |

**Every column is `NOT NULL`.** Recorded explicitly because it is a contract on the registration payload, not just a storage detail.

- `full_name` being NOT NULL makes a name a **required** registration field: the practitioner reads a day's appointments as a list of people, and a nameless booking is not actionable. There is no "anonymous patient" case in the MVP. If a future flow needs one, that is a migration and a contract change, not a nullable column added quietly.
- Enum `user_role = ('user','admin')`.
- `email` is `citext`, so uniqueness is case-insensitive **in the database** — `Alex@x.com` and `alex@x.com` cannot both exist, whether or not a caller normalised the address.
- **Single-admin invariant is a partial unique index**, not app logic: `CREATE UNIQUE INDEX users_single_admin_idx ON users (role) WHERE role = 'admin'`. Counting admins before inserting is the same check-then-insert race the ledger refuses elsewhere (CLAUDE.md §4), so the index is the arbiter. Ordinary users are unconstrained by it.
- `updated_at` is maintained by a `BEFORE UPDATE` trigger on the shared `set_updated_at()` function, so it is correct for every writer including hand-typed SQL.
- The **default admin** (`admin@physiobook.local`) is inserted by a **data migration**, not by `db:seed`: there is no admin-registration route, so an install without it cannot grow one.
- That admin's **password hash comes from `ADMIN_PASSWORD_HASH`** (via the `physiobook.admin_password_hash` run-time parameter, which is how a value reaches a `.sql` file the migrator runs verbatim). Unset, it falls back to a hash committed in the migration whose password is public — fine for a throwaway local database, and `db:migrate` warns whenever it takes that path. Read only on the first apply, since the insert is `ON CONFLICT DO NOTHING`.
- **The `NOTE:` in `0001_users_updated_at_and_admin.sql` is discharged** (E1.2). It asked that, once the repo gained a password-hashing library, the fallback hash be asserted against the plaintext its comment documents — `backend/tests/db/users.test.ts` now does exactly that (`bcrypt.compare('ChangeMe123!', …)`, plus a cost-12 check). Recorded here rather than by editing that comment: the migration has been applied and its SHA-256 is stored in `__drizzle_migrations.hash`, so the file is immutable (BACKEND_DEV.md §3) even for a comment-only change.

---

### 2.2 `sessions`

One row per login. This is what makes a stateless 15-minute access token revocable before it expires.

| Column       | Type          | Notes                                                 |
| ------------ | ------------- | ----------------------------------------------------- |
| `id`         | `uuid` PK     | `default gen_random_uuid()`                           |
| `user_id`    | `uuid`        | **FK → `users.id`**, `ON DELETE CASCADE`; indexed     |
| `token_hash` | `text`        | NOT NULL; SHA-256 of the refresh cookie's secret half |
| `expires_at` | `timestamptz` | NOT NULL; login time + `REFRESH_TTL_SECONDS` (7 days) |
| `revoked_at` | `timestamptz` | nullable; NULL means live. Logout sets it             |
| `created_at` | `timestamptz` | NOT NULL, `default now()`                             |

- **Every access token carries its `session_id`** (E1.3), so that the auth plugin can re-read this row per request and a revoked session logs its holder out immediately rather than at the next expiry. That plugin landed in E1.4, ahead of the `/auth/refresh` and `/auth/logout` that consume this row — the guards are what the rest of the API is built behind, and revocation is only a real property once something checks it on every request. The claim was required from E1.3 regardless, because a token issued without one would be a token nothing could ever revoke — which is also why `POST /auth/register` opens a session rather than issuing a lone token.
- **E1.6 is what finally reads and writes the two nullable-looking columns.** `POST /auth/refresh` requires all three of a matching `token_hash`, `revoked_at IS NULL` and `expires_at > now` before it re-signs an access token for this same row; `POST /auth/logout` stamps `revoked_at`. Two properties worth stating as schema facts rather than leaving to the service:
  - **A row is live or it is not — the three failures are indistinguishable to a caller.** Wrong secret, revoked, and expired all answer the same `401 UNAUTHORIZED` body as a session id nobody owns, so a holder of half a stolen credential learns nothing about the other half.
  - **`revoked_at` is written once.** The update carries `AND revoked_at IS NULL`, so a repeated logout cannot move a timestamp that reads as the moment its holder was cut off. This is the only reason the column needs no `updated_at` beside it (below) to stay honest.
- **The refresh cookie is opaque, not a JWT.** Its value is `<session_id>.<secret>`, where the secret is 32 bytes from the CSPRNG; only `sha256(secret)` is stored, so a dump of this table is not a set of usable cookies. The consequence is deliberate: nothing about the cookie can be verified without reading this row, which is exactly what makes revocation authoritative instead of advisory. An earlier plan for a second signing secret (`JWT_REFRESH_SECRET`, mentioned in `.env.example` before E1.3) was dropped for this reason.
- The session id is generated by the **application** for this one table, so the row lands in a single INSERT — the secret has to be minted against the id, and letting the column default choose it would mean inserting a placeholder hash and updating it afterwards, leaving a window where a session exists that no cookie can match. The `gen_random_uuid()` default stays for every other writer.
- **No `updated_at` and no trigger here.** `revoked_at` is the only mutation this table has, and it already is a timestamp of it. Adding a second one would be a column no reader could distinguish from the first.

---

### 2.3 `practice_settings` (singleton)

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

### 2.4 `business_hours`

Weekly recurring availability. The admin edits these freely; they define which slots _can_ exist.

| Column        | Type       | Notes                                                       |
| ------------- | ---------- | ----------------------------------------------------------- |
| `id`          | `uuid` PK  |                                                             |
| `day_of_week` | `smallint` | `0`–`6` (0 = Sunday); `CHECK (day_of_week BETWEEN 0 AND 6)` |
| `opens_at`    | `time`     | wall-clock, interpreted in `practice_settings.timezone`     |
| `closes_at`   | `time`     | `CHECK (closes_at > opens_at)`                              |

- Multiple rows per day allow split shifts (e.g. 09:00–13:00 and 15:00–18:00).
- **No same-day overlap** is a cross-row rule, enforced by the shared Zod contract rather than the database (windows are half-open, so 09:00–12:00 and 12:00–15:00 touch without overlapping). That is sound because the only writer, `PUT /business-hours` (E2.2), replaces the whole week in one transaction that first takes `LOCK TABLE business_hours IN SHARE ROW EXCLUSIVE MODE`: two concurrent replaces would otherwise each delete only the rows their snapshot saw and commit the union of two weeks. The lock does not block reads, so `GET` serves the previous week until the replace commits.
- Not a hard DB constraint on bookings — the API validates that a requested slot falls inside an open window. (Enforcing it purely in the DB would over-complicate the schema; it's covered by service logic + tests.)
- **Practice-wide, deliberately no `practitioner_id`** (decided in E2.3). The weekly hours are the practice's opening hours and apply to every practitioner; the slot grid is scoped by `practitioner_id` only on the `calendar_blocks` side, where the overlap constraint lives. Per-practitioner hours, if ever needed, are an additive migration (§8).

---

### 2.5 `calendar_blocks` — the occupancy ledger ⭐

Every reserved piece of time — a patient appointment **or** an admin time-off — is a row here.

| Column            | Type                | Notes                                                                      |
| ----------------- | ------------------- | -------------------------------------------------------------------------- |
| `id`              | `uuid` PK           | `default gen_random_uuid()`                                                |
| `practitioner_id` | `uuid`              | NOT NULL, **FK → `users.id`**; the seeded admin is the only practitioner   |
| `kind`            | `block_kind` enum   | `'appointment' \| 'time_off'`                                              |
| `period`          | `tstzrange`         | `[start, end)` in UTC; for appointments exactly one hour                   |
| `status`          | `block_status` enum | `'active' \| 'cancelled' \| 'cancelled_by_admin'` (default `'active'`)     |
| `note`            | `text`              | NULL; the admin's label for a time-off (E5.1); always NULL on appointments |
| `created_at`      | `timestamptz`       | NOT NULL, `default now()`                                                  |
| `updated_at`      | `timestamptz`       | NOT NULL, `default now()`; maintained by the `set_updated_at()` trigger    |

**The overlap constraint** (hand-written migration `0007_calendar_blocks_constraints.sql` — Drizzle's builder cannot express `EXCLUDE`):

```sql
-- No two ACTIVE blocks of one practitioner may overlap. This single line enforces:
--   • no double-booked appointment slot
--   • no appointment overlapping time-off
--   • no time-off overlapping an appointment
ALTER TABLE calendar_blocks
  ADD CONSTRAINT calendar_blocks_no_overlap
  EXCLUDE USING gist (practitioner_id WITH =, period WITH &&)
  WHERE (status = 'active');
```

**The shape CHECKs** (declared in the Drizzle schema, so they live in the generated migration):

```sql
-- Every period is finite, non-empty and half-open.
CONSTRAINT calendar_blocks_period_bounded CHECK (
  NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period)
  AND lower_inc(period) AND NOT upper_inc(period)
);

-- Appointments sit on the top of the UTC hour and are exactly one hour long.
CONSTRAINT calendar_blocks_appointment_on_the_hour CHECK (
  kind <> 'appointment' OR (
    date_trunc('hour', lower(period), 'UTC') = lower(period)
    AND upper(period) = lower(period) + interval '1 hour'
  )
);

-- Only time-off carries a note (added in E5.1, migration 0008).
CONSTRAINT calendar_blocks_note_time_off_only CHECK (kind = 'time_off' OR note IS NULL);
```

- **Scoped by `practitioner_id` from day one** (§8): Dr. A at 10:00 never blocks Dr. B at 10:00. There is no `practitioners` table — the single admin `users` row is practitioner #1, and writers (E3.2, E5.1) pass its id. No column default: a uuid generated by a migration cannot be a static default, and a missing practitioner should fail loudly.
- The `WHERE (status = 'active')` clause means a **cancelled** block — by the user (`cancelled`) or the admin (`cancelled_by_admin`) — frees its time immediately; a new booking for the same slot succeeds. **Status lives only here**, not on `appointments`: who cancelled is the one fact the appointment side needed, and the enum carries it.
- **Whole-hour-offset assumption.** The on-the-hour CHECK runs on the **UTC** hour (the explicit `'UTC'` argument keeps it independent of the session `TimeZone`). That equals the practice-local hour only for zones with a whole-hour UTC offset; a practice in e.g. `Asia/Kolkata` (+05:30) could not book its local on-the-hour slots. Accepted for the MVP; lifting it means replacing this CHECK, not the ledger.
- `time_off` blocks may be any length and need not align to the hour ("admin blocks time as he likes"); only the `period_bounded` CHECK applies to them.
- **Time-off writes (E5.1).** `POST /time-off` inserts the block and lets `calendar_blocks_no_overlap` decide; on `23P01` it then reads the overlapping active blocks only to list them in the 409. `DELETE /time-off/:id` is one conditional `UPDATE … SET status = 'cancelled' WHERE kind = 'time_off' AND status = 'active' AND upper(period) > now`, so concurrent cancels cannot both succeed; a miss is then classified as 404 / 409 / 422. Neither endpoint touches a block that has already ended.
- `practitioner_id` has no `ON DELETE` action: a practitioner with blocks cannot be deleted out from under the ledger.

---

### 2.6 `appointments`

The patient side of an `appointment`-kind block. One-to-one with its block.

| Column     | Type      | Notes                                                                |
| ---------- | --------- | -------------------------------------------------------------------- |
| `id`       | `uuid` PK | `default gen_random_uuid()`                                          |
| `block_id` | `uuid`    | NOT NULL, **FK → `calendar_blocks.id`**, unique, `ON DELETE CASCADE` |
| `user_id`  | `uuid`    | NOT NULL, **FK → `users.id`**; indexed                               |

- `block_id` is **unique** → exactly one appointment per block.
- **No status, no timestamps of its own.** Start/end come from the block's `period`, and status from the block's `status` — one source of truth for each, nothing to drift. Cancelling an appointment is a single `UPDATE` of its block.
- `user_id` has no `ON DELETE` action, so a patient with appointments cannot be deleted silently out of the practitioner's history.
- Not enforced by the database: that the referenced block has `kind = 'appointment'`. The only writer (E3.2) inserts both rows in one transaction.

---

### 2.7 `notification_log`

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
  │  │                                               ▲
  │  └──< sessions   (one per login; cascades)       │  (time_off rows have no appointment)
  └──< notification_log                              │
                                                     │
practice_settings (singleton)      business_hours ───┘ (defines which slots are offerable)
```

---

## 4. How each MVP rule maps to the schema

| Rule                                               | Enforced by                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Can't book a taken slot / **race**                 | `EXCLUDE` constraint on `calendar_blocks.period` (DB-level, concurrency-safe)                                      |
| Appointments are hourly, on the hour               | `calendar_blocks_appointment_on_the_hour` CHECK                                                                    |
| Admin time-off can't overlap existing appointments | same `EXCLUDE` constraint (insert of the time-off block fails)                                                     |
| Cancel frees the slot                              | flip block `status` off `'active'`; the `EXCLUDE … WHERE (status = 'active')` ignores it                           |
| No user cancel within 24h                          | service logic vs `cancellation_cutoff_hours`; DB has no time-of-day awareness                                      |
| 24h reminders (user + admin, grouped)              | pg-boss job scheduled at `start − reminder_lead_hours`; `notification_log.dedupe_key` guarantees once              |
| Admin sets business days/hours                     | `business_hours` rows                                                                                              |
| Workload dashboard                                 | aggregate query over `calendar_blocks` within `business_hours`                                                     |
| Nearest-appointment countdown                      | `SELECT min(lower(period)) … WHERE user_id = ? AND status active AND lower(period) > now()`                        |
| Roles (JWT)                                        | `users.role`; verified in the Fastify auth plugin                                                                  |
| Logout takes effect before the token expires       | `sessions.revoked_at` (written by `POST /auth/logout`), re-read per request against the token's `session_id` claim |

---

## 5. Indexes

- `calendar_blocks`: the partial GiST index `(practitioner_id, period) WHERE status = 'active'` backing the `EXCLUDE` constraint also serves active range queries. A partial index `(lower(period)) WHERE status='active'` for "upcoming" lookups is deferred until a query needs it.
- `appointments`: `btree (user_id)` (`appointments_user_id_idx`), unique `(block_id)`.
- `users`: unique `(email)` (case-insensitive via `citext`), plus the partial unique `(role) WHERE role = 'admin'`.
- `sessions`: `btree (user_id)` — Postgres does not index a foreign key for you, and both the cascade from `users` and a future "log out everywhere" scan by it.
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

- Add a `practitioners` concept — **done (E3.1):** the single admin `users` row is practitioner #1; there is no `practitioners` table.
- Add a `practitioner_id` column to the **scoping** tables — **done for `calendar_blocks` (E3.1).** `appointments` reaches its practitioner through its block rather than duplicating the column. `business_hours` stays practice-wide (decided in E2.3, §2.4); per-practitioner hours would add the column then.
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

1. ~~Should `time_off` support a reason/label the admin can see on the dashboard?~~ **Resolved in E5.1:** a nullable `note` on `calendar_blocks`, time-off only (§2.5).
2. Do we keep cancelled appointments forever for history, or soft-archive after N months? (Affects dashboard queries, not the MVP.)
