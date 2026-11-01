import type { FastifyInstance } from 'fastify';

import { buildServer } from '../../src/server.js';

export const TEST_JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256';
export const TEST_JWT_TTL_SECONDS = 900;
export const TEST_REFRESH_TTL_SECONDS = 604_800;

const TEST_RATE_LIMIT_MAX = 10_000;

export interface TestAppOptions {
  databaseUrl: string;
  now?: () => Date;
  jwtTtlSeconds?: number;
  refreshTtlSeconds?: number;
  secureCookies?: boolean;
  rateLimitMax?: number;
  refreshRateLimitMax?: number;
  bookingRateLimitMax?: number;
  trustProxy?: boolean | number | string[];
}

export function buildTestApp({
  databaseUrl,
  now,
  jwtTtlSeconds = TEST_JWT_TTL_SECONDS,
  refreshTtlSeconds = TEST_REFRESH_TTL_SECONDS,
  secureCookies = false,
  rateLimitMax = TEST_RATE_LIMIT_MAX,
  refreshRateLimitMax = TEST_RATE_LIMIT_MAX,
  bookingRateLimitMax = TEST_RATE_LIMIT_MAX,
  trustProxy = false,
}: TestAppOptions): Promise<FastifyInstance> {
  return buildServer({
    databaseUrl,
    jwtSecret: TEST_JWT_SECRET,
    jwtTtlSeconds,
    refreshTtlSeconds,
    secureCookies,
    rateLimit: {
      max: rateLimitMax,
      refreshMax: refreshRateLimitMax,
      bookingMax: bookingRateLimitMax,
      timeWindow: 60_000,
    },
    trustProxy,
    logger: false,
    ...(now === undefined ? {} : { now }),
  });
}
