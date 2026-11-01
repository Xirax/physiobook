import type { z } from 'zod';

import type {
  blockConflictSchema,
  createTimeOffRequestSchema,
  timeOffConflictResponseSchema,
  timeOffParamsSchema,
  timeOffSchema,
} from '../schemas/time-off.js';

export type CreateTimeOffRequest = z.infer<typeof createTimeOffRequestSchema>;
export type TimeOffParams = z.infer<typeof timeOffParamsSchema>;
export type TimeOff = z.infer<typeof timeOffSchema>;
export type BlockConflict = z.infer<typeof blockConflictSchema>;
export type TimeOffConflictResponse = z.infer<typeof timeOffConflictResponseSchema>;
