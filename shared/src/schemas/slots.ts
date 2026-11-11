import { z } from 'zod';

import { inclusiveDays } from './date-range.js';

export const SLOT_RANGE_MAX_DAYS = 62;

export const slotsQuerySchema = z
  .strictObject({
    from: z.iso.date({ message: 'Enter a date as YYYY-MM-DD' }),
    to: z.iso.date({ message: 'Enter a date as YYYY-MM-DD' }),
  })
  .refine((query) => query.to >= query.from, {
    message: 'The range must end on or after its first day',
    path: ['to'],
    when: (payload) => payload.issues.length === 0,
  })
  .refine((query) => inclusiveDays(query.from, query.to) <= SLOT_RANGE_MAX_DAYS, {
    message: `The range can span at most ${SLOT_RANGE_MAX_DAYS} days`,
    path: ['to'],
    when: (payload) => payload.issues.length === 0,
  });

export const slotSchema = z.strictObject({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
});

export const slotsResponseSchema = z.strictObject({
  timezone: z.string(),
  slots: z.array(slotSchema),
});
