import { users } from '@physiobook/db';
import type { AdminAppointmentsQuery } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { updateSettings } from '../settings/settings.service.js';

import { listAdminAppointments } from './admin-appointments.service.js';

type Status = 'active' | 'cancelled' | 'cancelled_by_admin';

const onMonday = (hourUtc: number) => `2026-11-09T${String(hourUtc).padStart(2, '0')}:00:00.000Z`;

// Mid-appointment, so a 10:00Z slot is in progress and an 11:00Z one is upcoming.
const NOW = new Date('2026-11-09T10:30:00Z');

const UPCOMING_ACTIVE: AdminAppointmentsQuery = { status: 'active' };

describe('listAdminAppointments', () => {
  let database: TestDatabase;
  let adminId: string;
  let noraId: string;
  let olafId: string;

  const list = (
    query: AdminAppointmentsQuery = UPCOMING_ACTIVE,
    { now = NOW, practitioner = adminId } = {},
  ) => listAdminAppointments(practitioner, query, { db: database.db, now: () => now });

  const startsOf = async (query?: AdminAppointmentsQuery, options?: { now?: Date }) =>
    (await list(query, options)).map((appointment) => appointment.start);

  interface AppointmentOptions {
    patient?: string;
    status?: Status;
    practitioner?: string;
  }

  const insertAppointment = async (start: string, options: AppointmentOptions = {}) => {
    const { rows } = await database.pool.query<{ id: string }>(
      `WITH block AS (
         INSERT INTO calendar_blocks (practitioner_id, kind, status, period)
         VALUES ($1, 'appointment', $2, tstzrange($3, $3::timestamptz + interval '1 hour', '[)'))
         RETURNING id
       )
       INSERT INTO appointments (block_id, user_id) SELECT id, $4 FROM block RETURNING id`,
      [
        options.practitioner ?? adminId,
        options.status ?? 'active',
        start,
        options.patient ?? noraId,
      ],
    );
    return rows[0]!.id;
  };

  const insertPatient = async (email: string, fullName: string) => {
    const [patient] = await database.db
      .insert(users)
      .values({ email, passwordHash: 'not-a-real-hash', fullName })
      .returning({ id: users.id });
    return patient!.id;
  };

  beforeAll(async () => {
    database = await createTestDatabase();

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    adminId = admin!.id;

    noraId = await insertPatient('nora@example.com', 'Nora Patient');
    olafId = await insertPatient('olaf@example.com', 'Olaf Patient');

    await updateSettings(
      { timezone: 'Europe/Warsaw', reminder_lead_hours: 24, cancellation_cutoff_hours: 24 },
      { db: database.db },
    );
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await database?.drop();
  });

  it('Returns every patient’s appointments with their start, end, status and patient details', async () => {
    const noraAppointment = await insertAppointment(onMonday(12), { patient: noraId });
    const olafAppointment = await insertAppointment(onMonday(13), { patient: olafId });

    await expect(list()).resolves.toEqual([
      {
        id: noraAppointment,
        start: onMonday(12),
        end: onMonday(13),
        status: 'active',
        patient: { id: noraId, email: 'nora@example.com', full_name: 'Nora Patient' },
      },
      {
        id: olafAppointment,
        start: onMonday(13),
        end: onMonday(14),
        status: 'active',
        patient: { id: olafId, email: 'olaf@example.com', full_name: 'Olaf Patient' },
      },
    ]);
  });

  it('Returns an empty list when nothing matches', async () => {
    await expect(list()).resolves.toEqual([]);
  });

  it('Lists only appointments starting after now when no range is given', async () => {
    await insertAppointment('2026-11-02T09:00:00.000Z');
    await insertAppointment(onMonday(9));
    await insertAppointment(onMonday(10));
    await insertAppointment(onMonday(11));

    expect(await startsOf()).toEqual([onMonday(11)]);
  });

  it('Excludes an appointment starting exactly now from the upcoming list', async () => {
    await insertAppointment(onMonday(11));
    await insertAppointment(onMonday(12));

    expect(await startsOf(UPCOMING_ACTIVE, { now: new Date(onMonday(11)) })).toEqual([
      onMonday(12),
    ]);
  });

  it('Hides cancelled appointments under the default active filter', async () => {
    await insertAppointment(onMonday(11), { status: 'cancelled' });
    await insertAppointment(onMonday(12), { status: 'cancelled_by_admin' });
    await insertAppointment(onMonday(13));

    expect(await startsOf()).toEqual([onMonday(13)]);
  });

  it.each<[Status, string]>([
    ['cancelled', onMonday(11)],
    ['cancelled_by_admin', onMonday(12)],
    ['active', onMonday(13)],
  ])('Filters to %s appointments only', async (status, expectedStart) => {
    await insertAppointment(onMonday(11), { status: 'cancelled' });
    await insertAppointment(onMonday(12), { status: 'cancelled_by_admin' });
    await insertAppointment(onMonday(13));

    expect(await startsOf({ status })).toEqual([expectedStart]);
  });

  it('Returns every status with the any filter', async () => {
    await insertAppointment(onMonday(11), { status: 'cancelled' });
    await insertAppointment(onMonday(12), { status: 'cancelled_by_admin' });
    await insertAppointment(onMonday(13));

    const statuses = (await list({ status: 'any' })).map((appointment) => appointment.status);
    expect(statuses).toEqual(['cancelled', 'cancelled_by_admin', 'active']);
  });

  it('Reveals past and in-progress appointments inside an explicit range', async () => {
    await insertAppointment('2026-11-02T09:00:00.000Z');
    await insertAppointment(onMonday(10));
    await insertAppointment(onMonday(12));

    expect(await startsOf({ from: '2026-11-02', to: '2026-11-09', status: 'active' })).toEqual([
      '2026-11-02T09:00:00.000Z',
      onMonday(10),
      onMonday(12),
    ]);
  });

  it('Bounds the range by practice-timezone days, both ends inclusive', async () => {
    // Warsaw is on CET (UTC+1): 2026-11-09 local runs 2026-11-08T23:00Z - 2026-11-09T23:00Z.
    await insertAppointment('2026-11-08T22:00:00.000Z');
    await insertAppointment('2026-11-08T23:00:00.000Z');
    await insertAppointment(onMonday(22));
    await insertAppointment(onMonday(23));

    expect(await startsOf({ from: '2026-11-09', to: '2026-11-09', status: 'active' })).toEqual([
      '2026-11-08T23:00:00.000Z',
      onMonday(22),
    ]);
  });

  it('Spans all 25 hours of a fall-back day', async () => {
    // 2026-10-25 Warsaw: midnight is CEST (UTC+2), the next midnight CET (UTC+1).
    await insertAppointment('2026-10-24T21:00:00.000Z');
    await insertAppointment('2026-10-24T22:00:00.000Z');
    await insertAppointment('2026-10-25T22:00:00.000Z');
    await insertAppointment('2026-10-25T23:00:00.000Z');

    expect(await startsOf({ from: '2026-10-25', to: '2026-10-25', status: 'active' })).toEqual([
      '2026-10-24T22:00:00.000Z',
      '2026-10-25T22:00:00.000Z',
    ]);
  });

  it('Combines a range with a status filter', async () => {
    await insertAppointment('2026-11-02T09:00:00.000Z', { status: 'cancelled' });
    await insertAppointment('2026-11-02T10:00:00.000Z');

    expect(await startsOf({ from: '2026-11-02', to: '2026-11-02', status: 'cancelled' })).toEqual([
      '2026-11-02T09:00:00.000Z',
    ]);
  });

  it('Orders by start whatever the insertion order', async () => {
    await insertAppointment(onMonday(15));
    await insertAppointment(onMonday(11));
    await insertAppointment(onMonday(13));

    expect(await startsOf()).toEqual([onMonday(11), onMonday(13), onMonday(15)]);
  });

  it('Ignores another practitioner’s appointments', async () => {
    await insertAppointment(onMonday(11), { practitioner: olafId });

    await expect(list()).resolves.toEqual([]);
  });
});
