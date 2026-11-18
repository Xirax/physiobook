import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { userRole, users } from './users.js';

/**
 * `notification_log` — our record of every notification that went out
 * (SCHEMA.md §2.7). The unique `dedupe_key` is what makes a notification
 * exactly-once: a job claims its key by inserting the row in the same
 * transaction that sends the mail, so a pg-boss retry finds the key taken.
 */
export const notificationLog = pgTable('notification_log', {
  id: uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  recipientRole: userRole().notNull(),
  recipientUserId: uuid().references(() => users.id),

  type: text().notNull(),
  dedupeKey: text().notNull().unique('notification_log_dedupe_key_unique'),
  sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  payload: jsonb().notNull(),
});
