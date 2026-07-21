-- Hand-written companion to 0000_users.sql (ticket E1.1).
--
-- Everything here is outside Drizzle's schema builder — a trigger function, a
-- trigger, and a data migration — so it is owned as explicit SQL rather than
-- coaxed out of the ORM (SCHEMA.md §6).
--
-- The breakpoint markers below are the only thing the migrator splits this file
-- on, so the semicolons inside the dollar-quoted function body are safe. It is
-- a blind text split, though: do not write that marker anywhere it is not meant
-- as one — including inside a comment like this one, which cuts the file in
-- half and hands Postgres the prose.

-- The reusable updated_at trigger function (PROJECT_STRUCTURE.md §5).
--
-- Created once, here, because `users` is the first table that needs it; every
-- later table attaches its own trigger to this same function rather than
-- redefining it. Keeping the timestamp honest in the database means it is right
-- for every writer — the API, a migration, a hand-typed UPDATE in psql — which
-- an ORM hook could never promise.
--
-- `now()` is the transaction timestamp, so all rows touched by one transaction
-- share an updated_at, and it is UTC like every other timestamp here.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Data migration: the practice's single admin.
--
-- Seeded by a migration rather than by `db:seed` on purpose. The app serves one
-- practitioner and has no admin-registration route — an environment without this
-- row has no way to grow one, so it is part of the schema's meaning, not demo
-- data. Tests may not depend on seeds (db/src/seed.ts); they may depend on this.
--
-- The hash comes from the `physiobook.admin_password_hash` run-time parameter,
-- which db/src/migrate.ts sets from ADMIN_PASSWORD_HASH (see .env.example).
-- Deployments set it and never ship the fallback below.
--
-- The fallback IS PUBLIC — it is in this file and in the git history — and
-- exists so a developer gets a working login from `docker compose up` alone.
-- It is reached only on a database with no admin yet, and `pnpm db:migrate`
-- prints a warning whenever it is about to be used.
--
--   email:    admin@physiobook.local
--   password: ChangeMe123!   (fallback only)
--   hash:     bcrypt, cost 12
--
-- NOTE: nothing yet proves that plaintext still matches that hash — this repo
-- has no password-hashing library to check it with. When the auth module adds
-- one, assert the pair in backend/tests/db/users.test.ts so the two cannot
-- drift into a comment that lies.
--
-- ON CONFLICT DO NOTHING keeps the migration re-runnable against a database that
-- already has an admin — and, more usefully, means a deployment that changed the
-- password is not silently reverted if this ever replays. It is unqualified
-- because either unique index can be the one that fires: a same-email row
-- conflicts on users_email_unique, a differently-addressed admin on
-- users_single_admin_idx.
INSERT INTO users (email, password_hash, role, full_name)
VALUES (
  'admin@physiobook.local',
  -- `true` makes an unset parameter NULL instead of an error; NULLIF then folds
  -- an explicitly-blank one onto the same branch, so neither can create an
  -- admin whose password_hash matches nothing.
  COALESCE(
    NULLIF(current_setting('physiobook.admin_password_hash', true), ''),
    '$2b$12$ysW7fBnWX1IJCz7KDEmBIeSXr3jGrIMNFEeJDiu0iz9j2dA4L7uxi'
  ),
  'admin',
  'PhysioBook Admin'
)
ON CONFLICT DO NOTHING;
