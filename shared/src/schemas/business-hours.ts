import { z } from 'zod';

// Zero-padded 24h HH:MM, so lexical order is chronological order and the
// window and overlap checks below can compare the strings directly.
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeOfDaySchema = z
  .string()
  .regex(TIME_OF_DAY, { message: 'Enter a time as HH:MM, between 00:00 and 23:59' });

export const dayOfWeekSchema = z
  .int()
  .min(0, { message: 'Day of week must be 0 (Sunday) to 6 (Saturday)' })
  .max(6, { message: 'Day of week must be 0 (Sunday) to 6 (Saturday)' });

export const businessHoursWindowSchema = z
  .strictObject({
    day_of_week: dayOfWeekSchema,
    opens_at: timeOfDaySchema,
    closes_at: timeOfDaySchema,
  })
  .refine((window) => window.closes_at > window.opens_at, {
    message: 'Closing time must be after opening time',
    path: ['closes_at'],
    // Comparing a malformed time would only repeat the format error above.
    when: (payload) => payload.issues.length === 0,
  });

type Window = z.infer<typeof businessHoursWindowSchema>;

// Windows are half-open [opens_at, closes_at), so 09:00-12:00 and 12:00-15:00
// touch without overlapping — the same convention as the calendar_blocks ledger.
function findSameDayOverlaps(windows: Window[]): number[] {
  const overlapping: number[] = [];
  const byDayThenOpening = windows
    .map((window, index) => ({ window, index }))
    .sort(
      (a, b) =>
        a.window.day_of_week - b.window.day_of_week ||
        a.window.opens_at.localeCompare(b.window.opens_at),
    );

  let latestClose: { day: number; closesAt: string } | undefined;
  for (const { window, index } of byDayThenOpening) {
    if (latestClose?.day === window.day_of_week && window.opens_at < latestClose.closesAt) {
      overlapping.push(index);
    }
    if (latestClose?.day !== window.day_of_week || window.closes_at > latestClose.closesAt) {
      latestClose = { day: window.day_of_week, closesAt: window.closes_at };
    }
  }

  return overlapping;
}

export const weeklyBusinessHoursSchema = z.strictObject({
  windows: z.array(businessHoursWindowSchema).superRefine(
    (windows, context) => {
      for (const index of findSameDayOverlaps(windows)) {
        context.addIssue({
          code: 'custom',
          message: 'Overlaps another window on the same day',
          path: [index],
        });
      }
    },
    // A malformed time would compare wrongly as text and report a false overlap.
    { when: (payload) => payload.issues.length === 0 },
  ),
});
