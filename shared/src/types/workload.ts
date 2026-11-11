import type { z } from 'zod';

import type {
  workloadGranularitySchema,
  workloadPeriodSchema,
  workloadQuerySchema,
  workloadResponseSchema,
} from '../schemas/workload.js';

export type WorkloadGranularity = z.infer<typeof workloadGranularitySchema>;
export type WorkloadQuery = z.infer<typeof workloadQuerySchema>;
export type WorkloadPeriod = z.infer<typeof workloadPeriodSchema>;
export type WorkloadResponse = z.infer<typeof workloadResponseSchema>;
