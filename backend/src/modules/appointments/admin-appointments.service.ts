import { appointments, calendarBlocks, type Database, users } from '@physiobook/db';
import type { AdminAppointmentsQuery, AdminAppointmentsResponse } from '@physiobook/shared';
import { and, eq, gt, gte, lt, type SQL } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { periodEnd, periodStart } from '../../lib/period.js';
import { getSettings } from '../settings/settings.service.js';

export interface AdminAppointmentsDependencies {
  db: Database;
  now: () => Date;
}

async function startsWithin(
  { from, to }: AdminAppointmentsQuery,
  { db, now }: AdminAppointmentsDependencies,
): Promise<SQL | undefined> {
  if (from === undefined || to === undefined) return gt(periodStart, now());

  const { timezone } = await getSettings({ db });
  const rangeStart = DateTime.fromISO(from, { zone: timezone }).toJSDate();
  const rangeEnd = DateTime.fromISO(to, { zone: timezone }).plus({ days: 1 }).toJSDate();

  return and(gte(periodStart, rangeStart), lt(periodStart, rangeEnd));
}

export async function listAdminAppointments(
  practitionerId: string,
  query: AdminAppointmentsQuery,
  dependencies: AdminAppointmentsDependencies,
): Promise<AdminAppointmentsResponse> {
  const rows = await dependencies.db
    .select({
      id: appointments.id,
      start: periodStart,
      end: periodEnd,
      status: calendarBlocks.status,
      patientId: users.id,
      email: users.email,
      fullName: users.fullName,
    })
    .from(appointments)
    .innerJoin(calendarBlocks, eq(calendarBlocks.id, appointments.blockId))
    .innerJoin(users, eq(users.id, appointments.userId))
    .where(
      and(
        eq(calendarBlocks.practitionerId, practitionerId),
        query.status === 'any' ? undefined : eq(calendarBlocks.status, query.status),
        await startsWithin(query, dependencies),
      ),
    )
    .orderBy(periodStart, appointments.id);

  return rows.map((row) => ({
    id: row.id,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    status: row.status,
    patient: { id: row.patientId, email: row.email, full_name: row.fullName },
  }));
}
