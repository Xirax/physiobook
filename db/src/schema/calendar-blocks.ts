import { sql } from 'drizzle-orm';
import { check, customType, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * `calendar_blocks` — the occupancy ledger (SCHEMA.md §2.5). Every reserved
 * stretch of a practitioner's time, appointment or time-off, is one row here,
 * so a single EXCLUDE constraint can forbid any two active rows overlapping.
 *
 * That constraint and the updated_at trigger are not expressible in Drizzle's
 * builder; they live in migrations/0007_calendar_blocks_constraints.sql.
 */

/**
 * Postgres' `tstzrange`. Kept as its text form (`["2026-01-05 10:00:00+00",…)`):
 * writers build it with `tstzrange(start, end, '[)')` in SQL, and readers that
 * need instants select `lower(period)` / `upper(period)` rather than parse it.
 */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => 'tstzrange',
});

export const blockKind = pgEnum('block_kind', ['appointment', 'time_off']);

export const blockStatus = pgEnum('block_status', ['active', 'cancelled', 'cancelled_by_admin']);

export const calendarBlocks = pgTable(
  'calendar_blocks',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    practitionerId: uuid()
      .notNull()
      .references(() => users.id),

    kind: blockKind().notNull(),
    period: tstzrange().notNull(),
    status: blockStatus().notNull().default('active'),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'calendar_blocks_period_bounded',
      sql`NOT isempty(${table.period})
        AND NOT lower_inf(${table.period}) AND NOT upper_inf(${table.period})
        AND lower_inc(${table.period}) AND NOT upper_inc(${table.period})`,
    ),
    // Checked on the UTC hour, which equals the practice-local hour only for
    // whole-hour UTC offsets (SCHEMA.md §2.5).
    check(
      'calendar_blocks_appointment_on_the_hour',
      sql`${table.kind} <> 'appointment' OR (
        date_trunc('hour', lower(${table.period}), 'UTC') = lower(${table.period})
        AND upper(${table.period}) = lower(${table.period}) + interval '1 hour'
      )`,
    ),
  ],
);

/**
 * `appointments` — the patient side of an `appointment` block (SCHEMA.md
 * §2.6), 1:1 by the unique `block_id`. Status and timing are read from the
 * block, so there is one source of truth for both.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    blockId: uuid()
      .notNull()
      .unique()
      .references(() => calendarBlocks.id, { onDelete: 'cascade' }),

    userId: uuid()
      .notNull()
      .references(() => users.id),
  },
  (table) => [index('appointments_user_id_idx').on(table.userId)],
);
