import type { FastifyInstance } from 'fastify';

import { buildServer } from '../../src/server.js';

export const TEST_JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256';
export const TEST_JWT_TTL_SECONDS = 900;

export interface TestAppOptions {
  databaseUrl: string;
  now?: () => Date;
  jwtTtlSeconds?: number;
}

export function buildTestApp({
  databaseUrl,
  now,
  jwtTtlSeconds = TEST_JWT_TTL_SECONDS,
}: TestAppOptions): Promise<FastifyInstance> {
  return buildServer({
    databaseUrl,
    jwtSecret: TEST_JWT_SECRET,
    jwtTtlSeconds,
    logger: false,
    ...(now === undefined ? {} : { now }),
  });
}
