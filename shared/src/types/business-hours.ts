import type { z } from 'zod';

import type {
  businessHoursWindowSchema,
  weeklyBusinessHoursSchema,
} from '../schemas/business-hours.js';

export type BusinessHoursWindow = z.infer<typeof businessHoursWindowSchema>;
export type WeeklyBusinessHours = z.infer<typeof weeklyBusinessHoursSchema>;
