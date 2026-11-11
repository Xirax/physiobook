import { calendarBlocks, type Database } from '@physiobook/db';
import type { WorkloadQuery, WorkloadResponse } from '@physiobook/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { periodEnd, periodStart, tstzrangeOf } from '../../lib/period.js';
import { getBusinessHours } from '../availability/business-hours.service.js';
import { getSettings } from '../settings/settings.service.js';

import { aggregateWorkload } from './workload.js';

export interface DashboardDependencies {
  db: Database;
}

export async function getWorkload(
  practitionerId: string,
  { from, to, granularity }: WorkloadQuery,
  { db }: DashboardDependencies,
): Promise<WorkloadResponse> {
  const [{ timezone }, { windows }] = await Promise.all([
    getSettings({ db }),
    getBusinessHours({ db }),
  ]);

  const range = {
    start: DateTime.fromISO(from, { zone: timezone }).toJSDate(),
    end: DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).toJSDate(),
  };

  const blocks = await db
    .select({ kind: calendarBlocks.kind, start: periodStart, end: periodEnd })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.practitionerId, practitionerId),
        eq(calendarBlocks.status, 'active'),
        sql`${calendarBlocks.period} && ${tstzrangeOf(range)}`,
      ),
    );

  return aggregateWorkload({
    timezone,
    windows,
    from,
    to,
    granularity,
    timeOff: blocks.filter((block) => block.kind === 'time_off'),
    appointments: blocks.filter((block) => block.kind === 'appointment'),
  });
}
