import { sql } from 'drizzle-orm';
import { check, integer, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `practice_settings` — the practice-wide policy singleton (SCHEMA.md §2.3).
 *
 * `id` is pinned to `1` by both the primary key and a CHECK, so a second row
 * is rejected at the database level rather than by a service-layer count —
 * the same reasoning as `users_single_admin_idx` (CLAUDE.md §4).
 *
 * `slotDurationMinutes` is stored, not hard-coded, but is not exposed as
 * editable: slots stay fixed 1h per domain rule (CLAUDE.md §4).
 */
export const practiceSettings = pgTable(
  'practice_settings',
  {
    id: smallint().primaryKey(),

    timezone: text().notNull(),
    slotDurationMinutes: integer().notNull().default(60),
    reminderLeadHours: integer().notNull().default(24),
    cancellationCutoffHours: integer().notNull().default(24),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('practice_settings_singleton', sql`${table.id} = 1`)],
);
