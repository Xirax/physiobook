import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../src/features/auth/auth-context';
import type { ApiClient } from '../src/lib/api-client';
import { createTestQueryClient, testAdmin } from './render-app';

export type RequestStub = (path: string, options?: { method?: string; body?: unknown }) => unknown;

/** An api-client whose answers a test scripts per path and method, signed in as the admin. */
export const providersWith = (answer: RequestStub, queryClient = createTestQueryClient()) => {
  const request = vi.fn((path: string, options?: { method?: string; body?: unknown }) =>
    Promise.resolve().then(() => answer(path, options)),
  );

  const auth: AuthContextValue = {
    state: { status: 'authenticated', user: testAdmin },
    api: { request, refresh: vi.fn() } as unknown as ApiClient,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext value={auth}>{children}</AuthContext>
    </QueryClientProvider>
  );

  return { request, queryClient, wrapper };
};
