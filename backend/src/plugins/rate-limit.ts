import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { RateLimitedError } from '../lib/errors.js';

export interface RateLimitPluginOptions {
  max: number;
  timeWindow: number | string;
}

export const RATE_LIMITED_ROUTE = { rateLimit: {} } as const;

export function rateLimitedRoute(max: number): { rateLimit: { max: number } } {
  return { rateLimit: { max } };
}

// For routes behind requireAuth/requireRole: the guard's onRequest hook runs
// before the limiter's, so the caller is known and patients sharing one address
// (a clinic's Wi-Fi) do not share one bucket.
export function rateLimitedPerUserRoute(max: number): {
  rateLimit: { max: number; keyGenerator: (request: FastifyRequest) => string };
} {
  return {
    rateLimit: {
      max,
      keyGenerator: (request) => (request.user === null ? request.ip : `user:${request.user.id}`),
    },
  };
}

async function rateLimitPlugin(
  app: FastifyInstance,
  { max, timeWindow }: RateLimitPluginOptions,
): Promise<void> {
  await app.register(fastifyRateLimit, {
    global: false,
    max,
    timeWindow,
    errorResponseBuilder: (_request, context) => new RateLimitedError(context.after),
  });
}

export default fp(rateLimitPlugin, { name: 'rate-limit' });
