import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);
