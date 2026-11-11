import { users } from '@physiobook/db';
import type { WorkloadQuery } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { replaceBusinessHours } from '../availability/business-hours.service.js';
import { updateSettings } from '../settings/settings.service.js';

import { getWorkload } from './dashboard.service.js';

const WEEKDAYS_9_TO_17 = {
  windows: [1, 2, 3, 4, 5].map((day_of_week) => ({
    day_of_week,
    opens_at: '09:00',
    closes_at: '17:00',
  })),
};

// 2026-11-09 is a Monday; Warsaw is on CET (UTC+1), so 09:00 local is 08:00Z.
const MONDAY: WorkloadQuery = { from: '2026-11-09', to: '2026-11-09', granularity: 'day' };

describe('dashboard service: getWorkload', () => {
  let database: TestDatabase;
  let practitionerId: string;
  let otherUserId: string;

  const setTimezone = (timezone: string) =>
    updateSettings(
      { timezone, reminder_lead_hours: 24, cancellation_cutoff_hours: 24 },
      { db: database.db },
    );

  const workloadFor = (query: WorkloadQuery = MONDAY, practitioner = practitionerId) =>
    getWorkload(practitioner, query, { db: database.db });

  interface BlockOptions {
    kind?: 'appointment' | 'time_off';
    status?: 'active' | 'cancelled' | 'cancelled_by_admin';
    practitioner?: string;
  }

  const insertBlock = (start: string, end: string, options: BlockOptions = {}) =>
    database.pool.query(
      `INSERT INTO calendar_blocks (practitioner_id, kind, status, period)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'))`,
      [
        options.practitioner ?? practitionerId,
        options.kind ?? 'appointment',
        options.status ?? 'active',
        start,
        end,
      ],
    );

  beforeAll(async () => {
    database = await createTestDatabase();

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    practitionerId = admin!.id;

    const [other] = await database.db
      .insert(users)
      .values({ email: 'other@example.com', passwordHash: 'not-a-real-hash', fullName: 'Other' })
      .returning({ id: users.id });
    otherUserId = other!.id;
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
    await setTimezone('Europe/Warsaw');
    await replaceBusinessHours(WEEKDAYS_9_TO_17, { db: database.db });
  });

  afterAll(async () => {
    await database?.drop();
  });

  it('Aggregates seeded appointments and time-off into capacity, booked and open', async () => {
    await insertBlock('2026-11-09T08:00:00Z', '2026-11-09T09:00:00Z');
    await insertBlock('2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z');
    await insertBlock('2026-11-09T12:00:00Z', '2026-11-09T14:00:00Z', { kind: 'time_off' });

    expect(await workloadFor()).toEqual([
      { period: '2026-11-09', capacity: 6, booked: 2, open: 4 },
    ]);
  });

  it('Counts a time-off that began before the range against capacity', async () => {
    await insertBlock('2026-11-06T12:00:00Z', '2026-11-09T10:00:00Z', { kind: 'time_off' });

    expect((await workloadFor())[0]?.capacity).toBe(6);
  });

  it('Counts only active blocks, whoever cancelled the others', async () => {
    await insertBlock('2026-11-09T08:00:00Z', '2026-11-09T09:00:00Z', { status: 'cancelled' });
    await insertBlock('2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z', {
      status: 'cancelled_by_admin',
    });
    await insertBlock('2026-11-09T10:00:00Z', '2026-11-09T16:00:00Z', {
      kind: 'time_off',
      status: 'cancelled',
    });

    expect(await workloadFor()).toEqual([
      { period: '2026-11-09', capacity: 8, booked: 0, open: 8 },
    ]);
  });

  it("Ignores another practitioner's blocks", async () => {
    await insertBlock('2026-11-09T08:00:00Z', '2026-11-09T09:00:00Z', {
      practitioner: otherUserId,
    });
    await insertBlock('2026-11-09T10:00:00Z', '2026-11-09T16:00:00Z', {
      kind: 'time_off',
      practitioner: otherUserId,
    });

    expect(await workloadFor()).toEqual([
      { period: '2026-11-09', capacity: 8, booked: 0, open: 8 },
    ]);
  });

  it('Reads the practice timezone from settings to bound the range', async () => {
    await setTimezone('UTC');
    await insertBlock('2026-11-09T23:00:00Z', '2026-11-10T00:00:00Z');

    expect((await workloadFor())[0]?.booked).toBe(1);
  });

  it('Includes past periods alongside future ones', async () => {
    await insertBlock('2025-11-10T08:00:00Z', '2025-11-10T09:00:00Z');

    const [week] = await workloadFor({
      from: '2025-11-10',
      to: '2025-11-16',
      granularity: 'week',
    });

    expect(week).toEqual({ period: '2025-11-10', capacity: 40, booked: 1, open: 39 });
  });
});
