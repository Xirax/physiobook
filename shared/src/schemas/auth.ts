import { z } from 'zod';

export const PASSWORD_MIN_BYTES = 8;
export const PASSWORD_MAX_BYTES = 72;
export const EMAIL_MAX_LENGTH = 254;
export const FULL_NAME_MAX_LENGTH = 200;

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

// These messages reach a person: the API returns them in an error response's
// `details`, and the client renders the same strings inline under the field.
// Zod's defaults ("Too small: expected string to have >=1 characters") describe
// a schema, not a mistake a user can act on.
export const emailSchema = z
  .email({ message: 'Enter a valid email address' })
  .max(EMAIL_MAX_LENGTH, {
    message: `Email must be at most ${String(EMAIL_MAX_LENGTH)} characters`,
  });

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Enter your full name' })
  .max(FULL_NAME_MAX_LENGTH, {
    message: `Name must be at most ${String(FULL_NAME_MAX_LENGTH)} characters`,
  });

export const roleSchema = z.enum(['user', 'admin']);

// `strictObject` rejects a client-supplied `role` with a 400 where the E1.2
// ticket says to ignore it — a deliberate deviation, see PROJECT_STRUCTURE.md §6.
export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  full_name: fullNameSchema,
});

// Deliberately not `passwordSchema`: login checks a password that already
// exists, so restating the strength rules here would tell someone with an older
// password that their own credential is invalid before it is even sent.
export const loginPasswordSchema = z
  .string()
  .min(1, { message: 'Enter your password' })
  .max(1024);

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
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

export const refreshResponseSchema = z.strictObject({
  token: z.string(),
});
