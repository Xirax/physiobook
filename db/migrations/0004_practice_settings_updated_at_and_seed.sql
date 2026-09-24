-- Hand-written companion to 0003_practice_settings.sql (ticket 2.1).
--
-- Attaches the shared set_updated_at() trigger function (created once in
-- 0001_users_updated_at_and_admin.sql) and seeds the singleton row. Both are
-- outside Drizzle's schema builder, same reasoning as that migration.

CREATE TRIGGER practice_settings_set_updated_at
  BEFORE UPDATE ON practice_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Defaults match the domain rules (CLAUDE.md §4): 24h reminder lead, 24h
-- cancellation cutoff, 60-minute slots. Timezone has no domain default, so it
-- seeds to UTC; the admin sets the practice's real IANA zone via PUT /settings.
--
-- ON CONFLICT DO NOTHING keeps this migration re-runnable, same as the admin
-- seed it mirrors — the CHECK (id = 1) constraint means there is only ever one
-- row to conflict on.
INSERT INTO practice_settings (id, timezone)
VALUES (1, 'UTC')
ON CONFLICT (id) DO NOTHING;
