import { describe, expect, it } from 'vitest';

import { nextWindowFor, sameWeek, validateRows, type WindowRow } from './weekly-windows';

const row = (key: string, day_of_week: number, opens_at: string, closes_at: string): WindowRow => ({
  key,
  day_of_week,
  opens_at,
  closes_at,
});

describe('nextWindowFor', () => {
  it('Offers a working day for a day that is still closed', () => {
    expect(nextWindowFor(1, [])).toEqual({ opens_at: '09:00', closes_at: '17:00' });
  });

  it('Starts a split shift where the day’s latest window closes', () => {
    const rows = [row('a', 1, '09:00', '12:00'), row('b', 1, '13:00', '15:30')];

    expect(nextWindowFor(1, rows)).toEqual({ opens_at: '15:30', closes_at: '16:30' });
  });

  it('Ignores the windows of other days', () => {
    expect(nextWindowFor(2, [row('a', 1, '09:00', '12:00')])).toEqual({
      opens_at: '09:00',
      closes_at: '17:00',
    });
  });

  it('Stops at the last minute of the day rather than spilling past midnight', () => {
    expect(nextWindowFor(1, [row('a', 1, '18:00', '23:15')])).toEqual({
      opens_at: '23:15',
      closes_at: '23:59',
    });
  });

  it('Has no window to offer once the day already runs to 23:59', () => {
    expect(nextWindowFor(1, [row('a', 1, '18:00', '23:59')])).toBeNull();
  });
});

describe('sameWeek', () => {
  it('Treats the same windows in another order as the same week', () => {
    const monday = { day_of_week: 1, opens_at: '09:00', closes_at: '12:00' };
    const tuesday = { day_of_week: 2, opens_at: '09:00', closes_at: '12:00' };

    expect(sameWeek([monday, tuesday], [tuesday, monday])).toBe(true);
  });

  it('Sees a changed time as a different week', () => {
    expect(
      sameWeek(
        [{ day_of_week: 1, opens_at: '09:00', closes_at: '12:00' }],
        [{ day_of_week: 1, opens_at: '09:00', closes_at: '12:15' }],
      ),
    ).toBe(false);
  });
});

describe('validateRows', () => {
  it('Finds nothing wrong with a valid split shift', () => {
    expect(validateRows([row('a', 1, '09:00', '12:00'), row('b', 1, '14:00', '18:00')]).size).toBe(
      0,
    );
  });

  it('Pins a closing time at or before the opening time to the row’s closing field', () => {
    expect(validateRows([row('a', 1, '12:00', '12:00')]).get('a')).toEqual({
      closes_at: 'Closing time must be after opening time',
    });
  });

  it('Pins a same-day overlap to the window that runs into the other', () => {
    const errors = validateRows([row('a', 1, '09:00', '13:00'), row('b', 1, '12:00', '15:00')]);

    expect(errors.get('a')).toBeUndefined();
    expect(errors.get('b')).toEqual({ overlap: 'Overlaps another window on the same day' });
  });

  it('Lets back-to-back windows touch, as the half-open contract does', () => {
    expect(validateRows([row('a', 1, '09:00', '12:00'), row('b', 1, '12:00', '15:00')]).size).toBe(
      0,
    );
  });

  it('Reports a missing time in the shared schema’s own words', () => {
    expect(validateRows([row('a', 1, '', '12:00')]).get('a')).toEqual({
      opens_at: 'Enter a time as HH:MM, between 00:00 and 23:59',
    });
  });
});
