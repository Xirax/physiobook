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
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  RATE_LIMITED: 'RATE_LIMITED',
  TIME_OFF_CONFLICT: 'TIME_OFF_CONFLICT',
  TIME_OFF_IN_PAST: 'TIME_OFF_IN_PAST',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
