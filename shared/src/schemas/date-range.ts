import { z } from 'zod';

const MS_PER_DAY = 86_400_000;

// Calendar dates parse as UTC midnight, so the difference is a whole number of
// days whatever the practice timezone — the range is counted in dates, not hours.
export const inclusiveDays = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / MS_PER_DAY + 1;

export const calendarDateSchema = z.iso.date({ message: 'Enter a date as YYYY-MM-DD' });

interface DateRange {
  from?: string | undefined;
  to?: string | undefined;
}

/** Ordering and length checks for a from/to range; a range missing an end passes through. */
export const refineDateRange = <T extends z.ZodType<DateRange>>(schema: T, maxDays: number): T =>
  schema
    .refine(({ from, to }) => from === undefined || to === undefined || to >= from, {
      message: 'The range must end on or after its first day',
      path: ['to'],
      when: (payload) => payload.issues.length === 0,
    })
    .refine(
      ({ from, to }) =>
        from === undefined || to === undefined || inclusiveDays(from, to) <= maxDays,
      {
        message: `The range can span at most ${String(maxDays)} days`,
        path: ['to'],
        when: (payload) => payload.issues.length === 0,
      },
    );
