import { z } from 'zod';

export const PASSWORD_MIN_BYTES = 8;
export const PASSWORD_MAX_BYTES = 72;

const byteLength = (value: string): number => {
  let bytes = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }

  return bytes;
};

export const passwordSchema = z
  .string()
  .refine((value) => byteLength(value) >= PASSWORD_MIN_BYTES, {
    message: `Password must be at least ${String(PASSWORD_MIN_BYTES)} bytes long`,
  })
  .refine((value) => byteLength(value) <= PASSWORD_MAX_BYTES, {
    message: `Password must be at most ${String(PASSWORD_MAX_BYTES)} bytes long`,
  });

export const emailSchema = z.email().max(254);

export const fullNameSchema = z.string().trim().min(1).max(200);

export const roleSchema = z.enum(['user', 'admin']);

// `strictObject` rejects a client-supplied `role` with a 400 where the E1.2
// ticket says to ignore it — a deliberate deviation, see PROJECT_STRUCTURE.md §6.
export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  full_name: fullNameSchema,
});

export const publicUserSchema = z.strictObject({
  id: z.uuid(),
  email: emailSchema,
  full_name: fullNameSchema,
  role: roleSchema,
  created_at: z.iso.datetime(),
});

export const authResponseSchema = z.strictObject({
  user: publicUserSchema,
  token: z.string(),
});
