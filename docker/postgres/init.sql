-- PhysioBook — Postgres extensions.
--
-- THIS FILE IS THE SINGLE ENABLER OF EXTENSIONS (PROJECT_STRUCTURE.md §5).
-- No Drizzle migration may ever run CREATE EXTENSION; both the compose Postgres
-- and the Testcontainers harness (backend/tests/helpers/test-db.ts) load this
-- file instead, so local, CI and production databases cannot drift apart.
--
-- Loaded by the official image from /docker-entrypoint-initdb.d ONLY on first
-- boot of an empty data directory. If you add an extension here, existing local
-- volumes will not pick it up: `docker compose down -v` and boot again.

-- Required by the anti-double-booking EXCLUDE constraint on calendar_blocks:
-- GiST cannot index the scalar practitioner_id alongside the tstzrange without
-- it (CLAUDE.md §4).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Case-insensitive email column on users, so Alice@x.com and alice@x.com are
-- the same account at the database level rather than by application convention.
CREATE EXTENSION IF NOT EXISTS citext;
