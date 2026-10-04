import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, time, uuid } from 'drizzle-orm/pg-core';

/**
 * `business_hours` — the weekly recurring windows that define which slots can
 * exist (SCHEMA.md §2.4). Wall-clock times, interpreted in
 * `practice_settings.timezone`. Several rows per day are split shifts.
 *
 * The per-row CHECKs back up the shared Zod contract. Same-day overlap is a
 * cross-row rule and is enforced by that contract alone, which is safe because
 * the only writer replaces the whole week in one serialized transaction.
 */
export const businessHours = pgTable(
  'business_hours',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    dayOfWeek: smallint().notNull(),
    opensAt: time().notNull(),
    closesAt: time().notNull(),
  },
  (table) => [
    check('business_hours_day_of_week', sql`${table.dayOfWeek} BETWEEN 0 AND 6`),
    check('business_hours_closes_after_opens', sql`${table.closesAt} > ${table.opensAt}`),
  ],
);
