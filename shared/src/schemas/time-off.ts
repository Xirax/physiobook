import { z } from 'zod';

import { errorResponseSchema } from './error.js';

export const TIME_OFF_NOTE_MAX_LENGTH = 500;

const instantSchema = z.iso.datetime({
  message: 'Enter a UTC timestamp, e.g. 2026-11-02T09:00:00Z',
});

export const createTimeOffRequestSchema = z
  .strictObject({
    start: instantSchema,
    end: instantSchema,
    note: z
      .string()
      .trim()
      .min(1, { message: 'Enter a note or leave it out' })
      .max(TIME_OFF_NOTE_MAX_LENGTH, {
        message: `Note must be at most ${String(TIME_OFF_NOTE_MAX_LENGTH)} characters`,
      })
      .optional(),
  })
  .refine((range) => Date.parse(range.end) > Date.parse(range.start), {
    message: 'Time off must end after it starts',
    path: ['end'],
    when: (payload) => payload.issues.length === 0,
  });

export const timeOffParamsSchema = z.strictObject({
  id: z.uuid({ message: 'Enter a valid time-off id' }),
});

export const timeOffSchema = z.strictObject({
  id: z.uuid(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  note: z.string().nullable(),
});

export const blockConflictSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['appointment', 'time_off']),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
});

export const timeOffConflictResponseSchema = errorResponseSchema.extend({
  conflicts: z.array(blockConflictSchema),
});
