import { calendarBlocks, type Database } from '@physiobook/db';
import type { SlotsQuery, SlotsResponse } from '@physiobook/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { periodEnd, periodStart, tstzrangeOf } from '../../lib/period.js';
import { findPractitionerId } from '../practitioner/practitioner.service.js';
import { getSettings } from '../settings/settings.service.js';

import { getBusinessHours } from './business-hours.service.js';
import { bookingWindow, generateSlots, type TimeRange } from './slot-grid.js';

export interface SlotsDependencies {
  db: Database;
  now: () => Date;
}

async function findActiveBlocks(
  db: Database,
  practitionerId: string,
  range: TimeRange,
): Promise<TimeRange[]> {
  return db
    .select({
      start: periodStart,
      end: periodEnd,
    })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.practitionerId, practitionerId),
        eq(calendarBlocks.status, 'active'),
        sql`${calendarBlocks.period} && ${tstzrangeOf(range)}`,
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
