import { describe, expect, it } from 'vitest';

import { buildServer } from './server.js';

/**
 * Unit/route test for the server scaffold (ticket 0.3).
 *
 * Uses Fastify `.inject()` — no port is ever bound, so this runs in
 * milliseconds and cannot collide with a dev server or another test.
 */
describe('buildServer', () => {
  it('serves a liveness response on /health', async () => {
    const app = buildServer({ logger: false });

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      // In a `finally` so a failed assertion still releases the instance;
      // otherwise the first failure leaves a handle open and Vitest hangs at
      // the end of the run instead of reporting the failure.
      await app.close();
    }
  });
});
