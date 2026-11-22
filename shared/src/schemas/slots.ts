import { z } from 'zod';

import { calendarDateSchema, refineDateRange } from './date-range.js';

export const SLOT_RANGE_MAX_DAYS = 62;

/** A slot is bookable only while now < start < now + this many days. */
export const BOOKING_HORIZON_DAYS = 62;

export const slotsQuerySchema = refineDateRange(
  z.strictObject({ from: calendarDateSchema, to: calendarDateSchema }),
  SLOT_RANGE_MAX_DAYS,
);

export const slotSchema = z.strictObject({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
});

export const slotsResponseSchema = z.strictObject({
  timezone: z.string(),
  slots: z.array(slotSchema),
});
