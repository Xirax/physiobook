import { z } from 'zod';

const sessionIdSchema = z.uuid();

export function isSessionId(value: string): boolean {
  return sessionIdSchema.safeParse(value).success;
}
