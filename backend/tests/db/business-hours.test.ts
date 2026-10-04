import { businessHours } from '@physiobook/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

describe('business_hours table', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  const insert = (dayOfWeek: number, opensAt: string, closesAt: string) =>
    database.pool.query(
      'INSERT INTO business_hours (day_of_week, opens_at, closes_at) VALUES ($1, $2, $3)',
      [dayOfWeek, opensAt, closesAt],
    );

  it('Starts empty, so no slot exists until the admin sets hours', async () => {
    expect(await database.db.select().from(businessHours)).toHaveLength(0);
  });

  it('Stores split shifts as several rows on the same day', async () => {
    await insert(1, '09:00', '12:00');
    await insert(1, '14:00', '18:30');

    const rows = await database.db.select().from(businessHours);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dayOfWeek: 1, opensAt: '09:00:00', closesAt: '12:00:00' }),
        expect.objectContaining({ dayOfWeek: 1, opensAt: '14:00:00', closesAt: '18:30:00' }),
      ]),
    );
  });

  it.each([-1, 7])('Rejects day_of_week %i', async (day) => {
    await expect(insert(day, '09:00', '12:00')).rejects.toThrow(
      /violates check constraint "business_hours_day_of_week"/,
    );
  });

  it.each([
    ['equal to', '12:00'],
    ['before', '11:00'],
  ])('Rejects a closing time %s the opening time', async (_, closesAt) => {
    await expect(insert(2, '12:00', closesAt)).rejects.toThrow(
      /violates check constraint "business_hours_closes_after_opens"/,
    );
  });
});
