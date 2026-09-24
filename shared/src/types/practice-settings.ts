import type { z } from 'zod';

import type {
  practiceSettingsSchema,
  updatePracticeSettingsSchema,
} from '../schemas/practice-settings.js';

export type PracticeSettings = z.infer<typeof practiceSettingsSchema>;
export type UpdatePracticeSettingsRequest = z.infer<typeof updatePracticeSettingsSchema>;
