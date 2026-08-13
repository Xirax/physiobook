import { z } from 'zod';

export const JWT_SECRET_MIN_LENGTH = 32;

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 900;
const DEFAULT_REFRESH_TTL_SECONDS = 604_800;
const DEFAULT_AUTH_RATE_LIMIT_MAX = 10;
const DEFAULT_AUTH_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_REFRESH_RATE_LIMIT_MAX = DEFAULT_AUTH_RATE_LIMIT_MAX * 10;

/**
 * The placeholder committed in `.env.example`, and therefore public. Rejected
 * under NODE_ENV=production; `env.test.ts` asserts the two stay identical.
 */
export const DEVELOPMENT_JWT_SECRET = 'dev-only-insecure-secret-change-me-before-any-deployment';

const BLANK_IS_INVALID = new Set(['NODE_ENV']);

const trustProxySchema = z
  .string()
  .default('false')
  .transform((value, ctx): boolean | number | string[] => {
    const trimmed = value.trim().toLowerCase();

    if (trimmed === '' || trimmed === 'false') return false;

    if (trimmed === 'true') {
      ctx.addIssue({
        code: 'custom',
        message:
          'cannot be `true`: that trusts the leftmost X-Forwarded-For entry, which the client ' +
          'writes, so the auth rate limit would count a new address every request. Give the ' +
          'number of proxies in front of this app (e.g. 1), or their addresses (e.g. ' +
          '10.0.0.0/8,loopback).',
      });

      return z.NEVER;
    }

    if (/^\d+$/.test(trimmed)) {
      const hops = Number(trimmed);

      if (hops < 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'as a hop count must be at least 1. Use `false` for no proxy at all.',
        });

        return z.NEVER;
      }

      return hops;
    }

    const addresses = trimmed
      .split(',')
      .map((address) => address.trim())
      .filter((address) => address !== '');

    if (addresses.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'lists no address' });

      return z.NEVER;
    }

    return addresses;
  });

/**
 * docker-compose substitutes an unset `${VAR}` as the empty string, so a
 * variable nobody set arrives as `''` rather than absent — which would coerce to
 * 0 and defeat every default below. Blank means unset, as it already does for
 * ADMIN_PASSWORD_HASH in db/src/env.ts.
 */
const blankToUndefined = (source: unknown): unknown => {
  if (typeof source !== 'object' || source === null) return source;

  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>).map(([key, value]) => [
      key,
      value === '' && !BLANK_IS_INVALID.has(key) ? undefined : value,
    ]),
  );
};

export const envSchema = z.preprocess(
  blankToUndefined,
  z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      DATABASE_URL: z.url(),
      JWT_SECRET: z.string().min(JWT_SECRET_MIN_LENGTH),
      JWT_ACCESS_TTL_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_ACCESS_TOKEN_TTL_SECONDS),
      REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(DEFAULT_REFRESH_TTL_SECONDS),
      AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(DEFAULT_AUTH_RATE_LIMIT_MAX),
      REFRESH_RATE_LIMIT_MAX: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_REFRESH_RATE_LIMIT_MAX),
      AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_AUTH_RATE_LIMIT_WINDOW_SECONDS),
      TRUST_PROXY: trustProxySchema,
      BACKEND_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
      BACKEND_HOST: z.string().min(1).default('0.0.0.0'),
    })
    .superRefine((env, ctx) => {
      if (env.NODE_ENV === 'production' && env.JWT_SECRET === DEVELOPMENT_JWT_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message:
            'is still the placeholder committed in .env.example, which is public. Generate one: ' +
            "node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\"",
        });
      }
    }),
);

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment — the server cannot start:\n${problems}\n\n` +
        'See .env.example for what each variable expects.',
    );
  }

  return result.data;
}
