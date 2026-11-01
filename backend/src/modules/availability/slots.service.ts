import { calendarBlocks, users, type Database } from '@physiobook/db';
import type { SlotsQuery, SlotsResponse } from '@physiobook/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getSettings } from '../settings/settings.service.js';

import { getBusinessHours } from './business-hours.service.js';
import { bookingWindow, generateSlots, type TimeRange } from './slot-grid.js';

export interface SlotsDependencies {
  db: Database;
  now: () => Date;
}

// The single admin is practitioner #1 (SCHEMA.md §2.5); users_single_admin_idx
// guarantees there is exactly one.
async function findPractitionerId(db: Database): Promise<string> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1);

  if (admin === undefined) throw new Error('the practitioner (admin) user is missing');

  return admin.id;
}

async function findActiveBlocks(
  db: Database,
  practitionerId: string,
  range: TimeRange,
): Promise<TimeRange[]> {
  return db
    .select({
      start: sql`lower(${calendarBlocks.period})`.mapWith(calendarBlocks.createdAt),
      end: sql`upper(${calendarBlocks.period})`.mapWith(calendarBlocks.createdAt),
    })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.practitionerId, practitionerId),
        eq(calendarBlocks.status, 'active'),
        sql`${calendarBlocks.period} && tstzrange(${range.start.toISOString()}, ${range.end.toISOString()}, '[)')`,
      ),
    );
}

export async function getBookableSlots(
  { from, to }: SlotsQuery,
  { db, now }: SlotsDependencies,
): Promise<SlotsResponse> {
  const [{ timezone }, { windows }, practitionerId] = await Promise.all([
    getSettings({ db }),
    getBusinessHours({ db }),
    findPractitionerId(db),
  ]);

  const range = {
    start: DateTime.fromISO(from, { zone: timezone }).toJSDate(),
    end: DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).toJSDate(),
  };
  const blocks = await findActiveBlocks(db, practitionerId, range);

  const slots = generateSlots({
    timezone,
    windows,
    from,
    to,
    blocks,
    within: bookingWindow(now()),
  });

  return {
    timezone,
    slots: slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    })),
  };
}
