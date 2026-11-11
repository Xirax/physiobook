import type { BusinessHoursWindow } from '@physiobook/shared';
import { describe, expect, it } from 'vitest';

import type { TimeRange } from '../availability/slot-grid.js';

import { aggregateWorkload, type WorkloadInput } from './workload.js';

const WEEKDAYS_9_TO_17: BusinessHoursWindow[] = [1, 2, 3, 4, 5].map((day_of_week) => ({
  day_of_week,
  opens_at: '09:00',
  closes_at: '17:00',
}));

// 2026-11-09 is a Monday; Warsaw is on CET (UTC+1), so 09:00 local is 08:00Z.
const MONDAY = '2026-11-09';

const range = (start: string, end: string): TimeRange => ({
  start: new Date(start),
  end: new Date(end),
});

const hourAt = (start: string): TimeRange =>
  range(start, new Date(Date.parse(start) + 3_600_000).toISOString());

const aggregate = (input: Partial<WorkloadInput> = {}) =>
  aggregateWorkload({
    timezone: 'Europe/Warsaw',
    windows: WEEKDAYS_9_TO_17,
    from: MONDAY,
    to: MONDAY,
    granularity: 'day',
    timeOff: [],
    appointments: [],
    ...input,
  });

describe('aggregateWorkload', () => {
  it('Reports an empty working day as all open', () => {
    expect(aggregate()).toEqual([{ period: MONDAY, capacity: 8, booked: 0, open: 8 }]);
  });

  it('Reports a fully booked day as all busy', () => {
    const appointments = Array.from({ length: 8 }, (_, index) =>
      hourAt(`2026-11-09T${String(8 + index).padStart(2, '0')}:00:00Z`),
    );

    expect(aggregate({ appointments })).toEqual([
      { period: MONDAY, capacity: 8, booked: 8, open: 0 },
    ]);
  });

  it('Returns every day of the range, closed days as zeros', () => {
    const periods = aggregate({ from: '2026-11-13', to: '2026-11-15' });

    expect(periods).toEqual([
      { period: '2026-11-13', capacity: 8, booked: 0, open: 8 },
      { period: '2026-11-14', capacity: 0, booked: 0, open: 0 },
      { period: '2026-11-15', capacity: 0, booked: 0, open: 0 },
    ]);
  });

  it('Gives a day fully covered by time-off zero capacity', () => {
    const timeOff = [range('2026-11-08T12:00:00Z', '2026-11-10T00:00:00Z')];

    expect(aggregate({ timeOff })).toEqual([{ period: MONDAY, capacity: 0, booked: 0, open: 0 }]);
  });

  it('Removes every slot a partial time-off touches from capacity', () => {
    const timeOff = [range('2026-11-09T09:30:00Z', '2026-11-09T11:00:00Z')];

    expect(aggregate({ timeOff })).toEqual([{ period: MONDAY, capacity: 6, booked: 0, open: 6 }]);
  });

  it('Counts an appointment outside business hours as booked without touching open', () => {
    const appointments = [hourAt('2026-11-09T17:00:00Z')];

    expect(aggregate({ appointments })).toEqual([
      { period: MONDAY, capacity: 8, booked: 1, open: 8 },
    ]);
  });

  it('Assigns an appointment to its practice-local day, not its UTC day', () => {
    const appointments = [hourAt('2026-11-09T23:00:00Z')];

    expect(aggregate({ to: '2026-11-10', appointments }).map((day) => day.booked)).toEqual([0, 1]);
  });

  it('Ignores appointments outside the range', () => {
    const appointments = [hourAt('2026-11-08T22:00:00Z'), hourAt('2026-11-10T08:00:00Z')];

    expect(aggregate({ appointments })[0]?.booked).toBe(0);
  });

  it('Counts the repeated fall-back hour as one slot', () => {
    // 2026-10-25 is a Sunday; Warsaw falls back from 03:00 CEST to 02:00 CET.
    const windows = [{ day_of_week: 0, opens_at: '00:00', closes_at: '04:00' }];

    expect(aggregate({ windows, from: '2026-10-25', to: '2026-10-25' })[0]?.capacity).toBe(4);
  });

  describe('week granularity', () => {
    it('Groups Monday to Sunday under the date of the Monday', () => {
      const appointments = [hourAt('2026-11-09T08:00:00Z'), hourAt('2026-11-13T15:00:00Z')];

      expect(
        aggregate({ from: '2026-11-09', to: '2026-11-22', granularity: 'week', appointments }),
      ).toEqual([
        { period: '2026-11-09', capacity: 40, booked: 2, open: 38 },
        { period: '2026-11-16', capacity: 40, booked: 0, open: 40 },
      ]);
    });

    it('Counts only the days inside the range in a partial edge week', () => {
      const periods = aggregate({ from: '2026-11-12', to: '2026-11-17', granularity: 'week' });

      expect(periods).toEqual([
        { period: '2026-11-09', capacity: 16, booked: 0, open: 16 },
        { period: '2026-11-16', capacity: 16, booked: 0, open: 16 },
      ]);
    });

    it('Leaves out an appointment from the same week but before the range', () => {
      const appointments = [hourAt('2026-11-10T08:00:00Z')];

      const [week] = aggregate({
        from: '2026-11-12',
        to: '2026-11-12',
        granularity: 'week',
        appointments,
      });

      expect(week?.booked).toBe(0);
    });

    it('Keeps a Monday 00:00 slot (Sunday 23:00Z) in its local week', () => {
      const windows = [{ day_of_week: 1, opens_at: '00:00', closes_at: '01:00' }];

      const periods = aggregate({
        windows,
        from: '2026-11-09',
        to: '2026-11-22',
        granularity: 'week',
      });

      expect(periods.map((week) => week.capacity)).toEqual([1, 1]);
    });
  });
});
