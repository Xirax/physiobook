import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { rateLimitedPerUserRoute } from './rate-limit.js';

const keyOf = (request: Partial<FastifyRequest>) =>
  rateLimitedPerUserRoute(5).rateLimit.keyGenerator(request as FastifyRequest);

describe('rateLimitedPerUserRoute', () => {
  it('Keys an authenticated request by its user, whatever its address', () => {
    const user = { id: 'u-1', role: 'user' as const, sessionId: 's-1' };

    expect(keyOf({ user, ip: '10.0.0.1' })).toBe('user:u-1');
    expect(keyOf({ user, ip: '10.0.0.2' })).toBe('user:u-1');
  });

  it('Falls back to the address when no guard identified the caller', () => {
    expect(keyOf({ user: null, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('Carries the given maximum', () => {
    expect(rateLimitedPerUserRoute(5).rateLimit.max).toBe(5);
  });
});
