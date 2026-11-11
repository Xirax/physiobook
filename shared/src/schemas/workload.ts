import { z } from 'zod';

import { inclusiveDays } from './date-range.js';

export const WORKLOAD_RANGE_MAX_DAYS = 92;

export const workloadGranularitySchema = z.enum(['day', 'week']);

export const workloadQuerySchema = z
  .strictObject({
    from: z.iso.date({ message: 'Enter a date as YYYY-MM-DD' }),
    to: z.iso.date({ message: 'Enter a date as YYYY-MM-DD' }),
    granularity: workloadGranularitySchema.default('day'),
  })
  .refine((query) => query.to >= query.from, {
    message: 'The range must end on or after its first day',
    path: ['to'],
    when: (payload) => payload.issues.length === 0,
  })
  .refine((query) => inclusiveDays(query.from, query.to) <= WORKLOAD_RANGE_MAX_DAYS, {
    message: `The range can span at most ${WORKLOAD_RANGE_MAX_DAYS} days`,
    path: ['to'],
    when: (payload) => payload.issues.length === 0,
  });

const countSchema = z.number().int().nonnegative();

/** `period` is a practice-tz date: the day itself, or the Monday of an ISO week. */
export const workloadPeriodSchema = z.strictObject({
  period: z.iso.date(),
  capacity: countSchema,
  booked: countSchema,
  open: countSchema,
});

export const workloadResponseSchema = z.array(workloadPeriodSchema);
