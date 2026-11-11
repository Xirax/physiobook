import type { Job } from 'pg-boss';
import { describe, expect, it } from 'vitest';

import { sendCancellationHandler } from './send-cancellation.job.js';

const jobWith = (data: unknown) =>
  ({ id: 'job-1', name: 'send-cancellation', data }) as Job<unknown>;

describe('sendCancellationHandler', () => {
  it('accepts a job naming the cancelled appointment', async () => {
    await expect(
      sendCancellationHandler([jobWith({ appointmentId: '4f1c2a52-6a47-4c5b-9b8e-3f2d1a0b9c7d' })]),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['no payload', null],
    ['a non-uuid id', { appointmentId: 'nope' }],
    ['an unknown field', { appointmentId: '4f1c2a52-6a47-4c5b-9b8e-3f2d1a0b9c7d', extra: 1 }],
  ])('fails the job for %s', async (_case, data) => {
    await expect(sendCancellationHandler([jobWith(data)])).rejects.toThrow();
  });
});
