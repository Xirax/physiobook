import type { SlotsQuery } from '@physiobook/shared';

import { calendarDate, dayRange } from '../../lib/practice-time';

export const PREVIEW_DAYS = 7;

/**
 * Today and the following days, counted in the practice timezone — not the
 * browser's — because that is the calendar the slot grid is built on.
 */
export function previewRange(now: Date, timezone: string): SlotsQuery {
  return dayRange(calendarDate(now, timezone), PREVIEW_DAYS);
}
