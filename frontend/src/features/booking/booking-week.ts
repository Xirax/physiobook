import { BOOKING_HORIZON_DAYS } from '@physiobook/shared';
import type { SlotsQuery } from '@physiobook/shared';

import { addDays, calendarDate, dayRange } from '../../lib/practice-time';

export const DAYS_PER_WEEK = 7;

export interface BookingWeek {
  week: SlotsQuery;
  canGoBack: boolean;
  canGoForward: boolean;
}

/**
 * The seven practice-tz days `offset` weeks from today. Stepping stops at today
 * and at the last day the booking horizon can still offer a slot on.
 */
export function bookingWeek(now: Date, timezone: string, offset: number): BookingWeek {
  const today = calendarDate(now, timezone);
  const from = addDays(today, offset * DAYS_PER_WEEK);

  return {
    week: dayRange(from, DAYS_PER_WEEK),
    canGoBack: offset > 0,
    canGoForward: addDays(from, DAYS_PER_WEEK) <= addDays(today, BOOKING_HORIZON_DAYS),
  };
}
