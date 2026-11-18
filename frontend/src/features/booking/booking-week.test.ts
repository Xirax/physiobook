import { describe, expect, it } from 'vitest';

import { bookingWeek } from './booking-week';

const now = new Date('2026-11-02T10:00:00Z');

describe('bookingWeek', () => {
  it('Starts at today and spans seven days', () => {
    expect(bookingWeek(now, 'Europe/Warsaw', 0).week).toEqual({
      from: '2026-11-02',
      to: '2026-11-08',
    });
  });

  it('Counts today in the practice timezone', () => {
    // 12:00 UTC on the 2nd is already 01:00 on the 3rd in Auckland.
    expect(bookingWeek(new Date('2026-11-02T12:00:00Z'), 'Pacific/Auckland', 0).week.from).toBe(
      '2026-11-03',
    );
  });

  it('Steps a whole week per offset', () => {
    expect(bookingWeek(now, 'Europe/Warsaw', 2).week).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    });
  });

  it('Cannot step back before this week', () => {
    expect(bookingWeek(now, 'UTC', 0).canGoBack).toBe(false);
    expect(bookingWeek(now, 'UTC', 1).canGoBack).toBe(true);
  });

  it('Stops stepping forward at the week holding the last day of the 62-day horizon', () => {
    const last = bookingWeek(now, 'UTC', 8);

    expect(last.week).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(last.canGoForward).toBe(false);
    expect(bookingWeek(now, 'UTC', 7).canGoForward).toBe(true);
  });
});
