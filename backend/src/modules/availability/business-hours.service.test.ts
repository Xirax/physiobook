import type { WeeklyBusinessHours } from '@physiobook/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

import { getBusinessHours, replaceBusinessHours } from './business-hours.service.js';

const window = (day_of_week: number, opens_at: string, closes_at: string) => ({
  day_of_week,
  opens_at,
  closes_at,
});

const STANDARD_WEEK: WeeklyBusinessHours = {
  windows: [1, 2, 3, 4, 5].map((day) => window(day, '09:00', '17:00')),
};

describe('business hours service', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  beforeEach(async () => {
    await replaceBusinessHours(STANDARD_WEEK, { db: database.db });
  });

  it('Rolls the whole replace back when a write fails partway, keeping the prior week', async () => {
    // Bypasses the Zod contract so the database CHECK is what rejects the
    // second window, after the delete and alongside a valid insert.
    const invalid = { windows: [window(0, '09:00', '12:00'), window(0, '15:00', '14:00')] };

    await expect(replaceBusinessHours(invalid, { db: database.db })).rejects.toThrow();

    expect(await getBusinessHours({ db: database.db })).toEqual(STANDARD_WEEK);
  });

  it('Leaves exactly one submitted week when replaces race', async () => {
    const weeks: WeeklyBusinessHours[] = Array.from({ length: 8 }, (_, index) => ({
      windows: [window(index % 7, '08:00', '10:00'), window(6, `1${index}:00`, `1${index}:30`)],
    }));

    await Promise.all(weeks.map((week) => replaceBusinessHours(week, { db: database.db })));

    const stored = await getBusinessHours({ db: database.db });
    expect(stored.windows).toHaveLength(2);
    expect(weeks.map((week) => sortWeek(week))).toContainEqual(stored);
  });
});

function sortWeek(week: WeeklyBusinessHours): WeeklyBusinessHours {
  return {
    windows: week.windows.toSorted(
      (a, b) => a.day_of_week - b.day_of_week || a.opens_at.localeCompare(b.opens_at),
    ),
  };
}
