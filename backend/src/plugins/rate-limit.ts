import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { RateLimitedError } from '../lib/errors.js';

export interface RateLimitPluginOptions {
  max: number;
  timeWindow: number | string;
}

export const RATE_LIMITED_ROUTE = { rateLimit: {} } as const;

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
