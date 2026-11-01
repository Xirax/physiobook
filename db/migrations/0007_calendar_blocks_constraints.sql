-- Hand-written companion to 0006_calendar_blocks_appointments.sql (ticket 3.1).
--
-- The anti-double-booking guarantee (CLAUDE.md §4): no two ACTIVE blocks of the
-- same practitioner may overlap, whether appointment or time-off. Being a
-- constraint, it holds under any concurrency; the losing insert fails with
-- SQLSTATE 23P01. Cancelled blocks fall outside the WHERE and free their time.
--
-- Scoped by practitioner_id from day one (SCHEMA.md §8) — do not un-scope it.
-- btree_gist, which lets GiST index the uuid, comes from docker/postgres/init.sql.
ALTER TABLE calendar_blocks
  ADD CONSTRAINT calendar_blocks_no_overlap
  EXCLUDE USING gist (practitioner_id WITH =, period WITH &&)
  WHERE (status = 'active');
--> statement-breakpoint

CREATE TRIGGER calendar_blocks_set_updated_at
  BEFORE UPDATE ON calendar_blocks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
