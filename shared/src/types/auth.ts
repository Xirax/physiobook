import type { z } from 'zod';

import type {
  authResponseSchema,
  publicUserSchema,
  registerRequestSchema,
  roleSchema,
} from '../schemas/auth.js';

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type UserRole = z.infer<typeof roleSchema>;
