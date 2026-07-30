import { z } from 'zod';

export const errorResponseSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  details: z
    .array(
      z.strictObject({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export const errorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
