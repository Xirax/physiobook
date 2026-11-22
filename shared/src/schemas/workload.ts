import { z } from 'zod';

import { calendarDateSchema, refineDateRange } from './date-range.js';

export const WORKLOAD_RANGE_MAX_DAYS = 92;

export const workloadGranularitySchema = z.enum(['day', 'week']);

export const workloadQuerySchema = refineDateRange(
  z.strictObject({
    from: calendarDateSchema,
    to: calendarDateSchema,
    granularity: workloadGranularitySchema.default('day'),
  }),
  WORKLOAD_RANGE_MAX_DAYS,
);

const countSchema = z.number().int().nonnegative();

/** `period` is a practice-tz date: the day itself, or the Monday of an ISO week. */
export const workloadPeriodSchema = z.strictObject({
  period: z.iso.date(),
  capacity: countSchema,
  booked: countSchema,
  open: countSchema,
});

export const workloadResponseSchema = z.array(workloadPeriodSchema);
