import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api-client';

const MAX_RETRIES = 2;

/**
 * A 4xx is the API answering, and asking again gets the same answer; only a
 * 5xx or a request that never landed is worth another try.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;

  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
