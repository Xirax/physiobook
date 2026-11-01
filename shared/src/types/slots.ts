import type { z } from 'zod';

import type { slotSchema, slotsQuerySchema, slotsResponseSchema } from '../schemas/slots.js';

export type SlotsQuery = z.infer<typeof slotsQuerySchema>;
export type Slot = z.infer<typeof slotSchema>;
export type SlotsResponse = z.infer<typeof slotsResponseSchema>;
