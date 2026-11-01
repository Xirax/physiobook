import { errorCodes } from '@physiobook/shared';
import { describe, expect, it } from 'vitest';

import { ApiError } from './api-client';
import { shouldRetry } from './query-client';

const refusal = (status: number) =>
  new ApiError(status, { code: errorCodes.VALIDATION_FAILED, message: 'refused' });

describe('shouldRetry', () => {
  it('Never asks again after the API answered with a 4xx', () => {
    expect(shouldRetry(0, refusal(400))).toBe(false);
    expect(shouldRetry(0, refusal(403))).toBe(false);
  });

  it('Tries a server fault again, a bounded number of times', () => {
    expect(shouldRetry(0, refusal(503))).toBe(true);
    expect(shouldRetry(1, refusal(503))).toBe(true);
    expect(shouldRetry(2, refusal(503))).toBe(false);
  });

  it('Tries a request that never reached the API again', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});
