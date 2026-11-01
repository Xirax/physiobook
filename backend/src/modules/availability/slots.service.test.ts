import { users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { updateSettings } from '../settings/settings.service.js';

import { replaceBusinessHours } from './business-hours.service.js';
import { getBookableSlots } from './slots.service.js';

const WEEKDAYS_9_TO_17 = {
  windows: [1, 2, 3, 4, 5].map((day_of_week) => ({
    day_of_week,
    opens_at: '09:00',
    closes_at: '17:00',
  })),
};

// 2026-11-09 is a Monday; Warsaw is on CET (UTC+1), so 09:00 local is 08:00Z.
const MONDAY = { from: '2026-11-09', to: '2026-11-09' };
const SUNDAY_BEFORE = new Date('2026-11-01T12:00:00Z');

describe('slots service', () => {
  let database: TestDatabase;
  let practitionerId: string;
  let otherUserId: string;

  const setTimezone = (timezone: string) =>
    updateSettings(
      { timezone, reminder_lead_hours: 24, cancellation_cutoff_hours: 24 },
      { db: database.db },
    );

  const slotsFor = (query = MONDAY, now = SUNDAY_BEFORE) =>
    getBookableSlots(query, { db: database.db, now: () => now });

  const startsFor = async (query = MONDAY, now = SUNDAY_BEFORE) =>
    (await slotsFor(query, now)).slots.map((slot) => slot.start);

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

  it('Returns every open slot of the range as UTC instants, with the practice timezone', async () => {
    const response = await slotsFor({ from: '2026-11-09', to: '2026-11-15' });

    expect(response.timezone).toBe('Europe/Warsaw');
    expect(response.slots).toHaveLength(5 * 8);
    expect(response.slots[0]).toEqual({
      start: '2026-11-09T08:00:00.000Z',
      end: '2026-11-09T09:00:00.000Z',
    });
    expect(response.slots.at(-1)?.start).toBe('2026-11-13T15:00:00.000Z');
  });

  it('Excludes a booked appointment and an active time-off', async () => {
    await insertBlock('2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z');
    await insertBlock('2026-11-09T12:00:00Z', '2026-11-09T14:30:00Z', { kind: 'time_off' });

    expect(await startsFor()).toEqual([
      '2026-11-09T08:00:00.000Z',
      '2026-11-09T10:00:00.000Z',
      '2026-11-09T11:00:00.000Z',
      '2026-11-09T15:00:00.000Z',
    ]);
  });

  it('Excludes slots under a time-off that began before the requested range', async () => {
    await insertBlock('2026-11-06T12:00:00Z', '2026-11-09T09:30:00Z', { kind: 'time_off' });

    expect((await startsFor())[0]).toBe('2026-11-09T10:00:00.000Z');
  });

  it('Ignores cancelled blocks, whoever cancelled them', async () => {
    await insertBlock('2026-11-09T08:00:00Z', '2026-11-09T09:00:00Z', { status: 'cancelled' });
    await insertBlock('2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z', {
      status: 'cancelled_by_admin',
    });

    expect(await startsFor()).toHaveLength(8);
  });

  it("Ignores another practitioner's blocks", async () => {
    await insertBlock('2026-11-09T08:00:00Z', '2026-11-09T16:00:00Z', {
      kind: 'time_off',
      practitioner: otherUserId,
    });

    expect(await startsFor()).toHaveLength(8);
  });

  it('Excludes slots that have already started relative to the injected clock', async () => {
    const midMonday = new Date('2026-11-09T11:30:00Z');

    expect((await startsFor(MONDAY, midMonday))[0]).toBe('2026-11-09T12:00:00.000Z');
  });

  it('Interprets business hours in the practice timezone from settings', async () => {
    await setTimezone('UTC');

    const response = await slotsFor();

    expect(response.timezone).toBe('UTC');
    expect(response.slots[0]?.start).toBe('2026-11-09T09:00:00.000Z');
  });

  it('Returns no slots while the practice has no business hours', async () => {
    await replaceBusinessHours({ windows: [] }, { db: database.db });

    expect(await startsFor()).toEqual([]);
  });
});
