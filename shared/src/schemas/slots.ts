import { z } from 'zod';

export const SLOT_RANGE_MAX_DAYS = 62;

const MS_PER_DAY = 86_400_000;

// Calendar dates parse as UTC midnight, so the difference is a whole number of
// days whatever the practice timezone — the range is counted in dates, not hours.
const inclusiveDays = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / MS_PER_DAY + 1;

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
