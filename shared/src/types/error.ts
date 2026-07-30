import type { z } from 'zod';

import type { errorCodes, errorResponseSchema } from '../schemas/error.js';

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
