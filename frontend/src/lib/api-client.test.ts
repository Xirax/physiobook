import {
  errorCodes,
  publicUserSchema,
  type ErrorResponse,
  type PublicUser,
} from '@physiobook/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, createApiClient, REFRESH_PATH } from './api-client';
import { createTokenStore } from './auth';

const user: PublicUser = {
  id: '4f9d3c4e-6d4f-4a1e-9a0f-3d3f5b1c2a11',
  email: 'grace@example.com',
  full_name: 'Grace Hopper',
  role: 'user',
  created_at: '2026-08-13T09:00:00.000Z',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const unauthorized = (): Response =>
  json(401, { code: errorCodes.UNAUTHORIZED, message: 'Authentication required' });

const authorizationOf = (init: RequestInit | undefined): string | null =>
  new Headers(init?.headers).get('authorization');

const clientWith = (fetch: typeof globalThis.fetch, token?: string) => {
  const tokens = createTokenStore();

  if (token !== undefined) tokens.set(token);

  return { tokens, api: createApiClient({ tokens, fetch }) };
};

const refusalOf = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;

    throw error;
  }

  throw new Error('Expected the request to be refused, but it resolved');
};

/** Lets every pending promise chain settle; a timer fires only once microtasks are drained. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createApiClient', () => {
  describe('Sending a request', () => {
    it('Attaches the access token it holds', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(200, user));
      const { api } = clientWith(fetch, 'access-token');

      await api.request('/auth/me', { schema: publicUserSchema });

      expect(authorizationOf(fetch.mock.calls[0]?.[1])).toBe('Bearer access-token');
    });

    it('Sends no authorization header when there is no token', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(200, user));
      const { api } = clientWith(fetch);

      await api.request('/auth/me', { schema: publicUserSchema });

      expect(authorizationOf(fetch.mock.calls[0]?.[1])).toBeNull();
    });

    it('Serialises a body as JSON and says so', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(201, user));
      const { api } = clientWith(fetch);

      await api.request('/auth/login', {
        method: 'POST',
        body: { email: 'grace@example.com', password: 'secret' },
      });

      const [, init] = fetch.mock.calls[0] ?? [];

      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('{"email":"grace@example.com","password":"secret"}');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    });

    it('Sends a PUT with its body, for the whole-resource replaces', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(200, { windows: [] }));
      const { api } = clientWith(fetch, 'access-token');

      await api.request('/business-hours', { method: 'PUT', body: { windows: [] } });

      const [path, init] = fetch.mock.calls[0] ?? [];

      expect(path).toBe('/business-hours');
      expect(init?.method).toBe('PUT');
      expect(init?.body).toBe('{"windows":[]}');
    });

    it('Parses the response with the schema it was given', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(200, user));
      const { api } = clientWith(fetch, 'access-token');

      await expect(api.request('/auth/me', { schema: publicUserSchema })).resolves.toEqual(user);
    });

    it('Rejects a response the contract does not describe, rather than passing it on', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(json(200, { id: 'not-a-uuid' }));
      const { api } = clientWith(fetch, 'access-token');

      await expect(api.request('/auth/me', { schema: publicUserSchema })).rejects.toBeInstanceOf(
        z.ZodError,
      );
    });

    it('Expects no body when it was given no schema', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }));
      const { api } = clientWith(fetch, 'access-token');

      await expect(api.request('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    });
  });

  describe('When the API refuses', () => {
    it('Throws an ApiError carrying the code callers branch on', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          json(409, { code: errorCodes.EMAIL_TAKEN, message: 'That email is already registered' }),
        );
      const { api } = clientWith(fetch);

      const error = await refusalOf(api.request('/auth/register', { method: 'POST', body: {} }));

      expect(error.status).toBe(409);
      expect(error.code).toBe(errorCodes.EMAIL_TAKEN);
      expect(error.message).toBe('That email is already registered');
    });

    it('Carries the per-field details a form needs', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        json(400, {
          code: errorCodes.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: [{ path: 'email', message: 'Invalid email address' }],
        }),
      );
      const { api } = clientWith(fetch);

      const error = await refusalOf(api.request('/auth/register', { method: 'POST', body: {} }));

      expect(error.details).toEqual([{ path: 'email', message: 'Invalid email address' }]);
    });

    it('Leaves details empty when the answer named none', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          json(401, { code: errorCodes.INVALID_CREDENTIALS, message: 'Invalid email or password' }),
        );
      const { api } = clientWith(fetch);

      expect((await refusalOf(api.request('/auth/login', { method: 'POST' }))).details).toEqual([]);
    });

    it('Names a body that is not the contract at all', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
      const { api } = clientWith(fetch);

      const error = await refusalOf(api.request('/auth/me', { schema: publicUserSchema }));

      expect(error.status).toBe(502);
      expect(error.code).toBe(errorCodes.INTERNAL_ERROR);
    });
  });

  describe('When an access token has expired', () => {
    const refreshingFetch = (
      onRefresh: () => Promise<Response>,
    ): { fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>; refreshCalls: () => number } => {
      let refreshCalls = 0;

      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (String(input) === REFRESH_PATH) {
          refreshCalls += 1;

          return onRefresh();
        }

        return authorizationOf(init) === 'Bearer fresh-token' ? json(200, user) : unauthorized();
      });

      return { fetch, refreshCalls: () => refreshCalls };
    };

    it('Refreshes once and retries, so the original request still succeeds', async () => {
      const { fetch, refreshCalls } = refreshingFetch(async () =>
        Promise.resolve(json(200, { token: 'fresh-token' })),
      );
      const { api, tokens } = clientWith(fetch, 'stale-token');

      await expect(api.request('/auth/me', { schema: publicUserSchema })).resolves.toEqual(user);

      expect(refreshCalls()).toBe(1);
      expect(tokens.get()).toBe('fresh-token');
    });

    it('Retries with the new token, not the one that was refused', async () => {
      const { fetch } = refreshingFetch(async () =>
        Promise.resolve(json(200, { token: 'fresh-token' })),
      );
      const { api } = clientWith(fetch, 'stale-token');

      await api.request('/auth/me', { schema: publicUserSchema });

      const attempts = fetch.mock.calls.filter(([input]) => String(input) === '/auth/me');

      expect(attempts.map(([, init]) => authorizationOf(init))).toEqual([
        'Bearer stale-token',
        'Bearer fresh-token',
      ]);
    });

    it('Calls /auth/refresh exactly once for requests that fail together', async () => {
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const { fetch, refreshCalls } = refreshingFetch(async () => {
        await gate;

        return json(200, { token: 'fresh-token' });
      });
      const { api } = clientWith(fetch, 'stale-token');

      const pending = Promise.all([
        api.request('/auth/me', { schema: publicUserSchema }),
        api.request('/auth/me', { schema: publicUserSchema }),
        api.request('/auth/me', { schema: publicUserSchema }),
      ]);

      // Every one of the three has been refused and is parked on the shared
      // refresh by now; releasing earlier would not prove they shared it.
      await settle();
      release();

      await expect(pending).resolves.toEqual([user, user, user]);
      expect(refreshCalls()).toBe(1);
    });

    it('Refreshes again for a later request, once the first flight has landed', async () => {
      const { fetch, refreshCalls } = refreshingFetch(async () =>
        Promise.resolve(json(200, { token: 'fresh-token' })),
      );
      const { api, tokens } = clientWith(fetch, 'stale-token');

      await api.request('/auth/me', { schema: publicUserSchema });
      tokens.set('stale-token');
      await api.request('/auth/me', { schema: publicUserSchema });

      expect(refreshCalls()).toBe(2);
    });

    it('Does not refresh for a request that carried no token', async () => {
      const { fetch, refreshCalls } = refreshingFetch(async () =>
        Promise.resolve(json(200, { token: 'fresh-token' })),
      );
      const { api } = clientWith(fetch);

      await refusalOf(api.request('/auth/login', { method: 'POST', body: {} }));

      expect(refreshCalls()).toBe(0);
    });
  });

  describe('When the refresh is refused', () => {
    it('Clears the token and reports what the original request was told', async () => {
      // The two 401s differ only by message, which is the instrumentation: in
      // production both read "Authentication required", and this is how the
      // test can say which of them reached the caller.
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
        Promise.resolve(
          json(401, {
            code: errorCodes.UNAUTHORIZED,
            message: String(input) === REFRESH_PATH ? 'the refresh was refused' : 'the request was',
          }),
        ),
      );
      const { api, tokens } = clientWith(fetch, 'stale-token');

      const error = await refusalOf(api.request('/auth/me', { schema: publicUserSchema }));

      expect(tokens.get()).toBeNull();
      expect(error.status).toBe(401);
      expect(error.code).toBe(errorCodes.UNAUTHORIZED);
      expect(error.message).toBe('the request was');
    });

    it('Keeps the session when the refresh could not be delivered at all', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
        String(input) === REFRESH_PATH
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(unauthorized()),
      );
      const { api, tokens } = clientWith(fetch, 'stale-token');

      await expect(api.request('/auth/me', { schema: publicUserSchema })).rejects.toBeInstanceOf(
        TypeError,
      );

      expect(tokens.get()).toBe('stale-token');
    });
  });

  describe('When the refresh fails without answering about the cookie', () => {
    const refreshFailingWith = (status: number, body: ErrorResponse) =>
      vi.fn<typeof globalThis.fetch>(async (input) =>
        String(input) === REFRESH_PATH
          ? Promise.resolve(json(status, body))
          : Promise.resolve(unauthorized()),
      );

    it('Keeps the session through a transient server fault', async () => {
      const fetch = refreshFailingWith(500, {
        code: errorCodes.INTERNAL_ERROR,
        message: 'Internal server error',
      });
      const { api, tokens } = clientWith(fetch, 'stale-token');

      await refusalOf(api.request('/auth/me', { schema: publicUserSchema }));

      expect(tokens.get()).toBe('stale-token');
    });

    it('Keeps the session when the refresh is rate limited', async () => {
      const fetch = refreshFailingWith(429, {
        code: errorCodes.RATE_LIMITED,
        message: 'Too many requests',
      });
      const { api, tokens } = clientWith(fetch, 'stale-token');

      await refusalOf(api.request('/auth/me', { schema: publicUserSchema }));

      expect(tokens.get()).toBe('stale-token');
    });

    it('Reports why the refresh failed, not the 401 that provoked it', async () => {
      const fetch = refreshFailingWith(502, {
        code: errorCodes.INTERNAL_ERROR,
        message: 'Bad gateway',
      });
      const { api } = clientWith(fetch, 'stale-token');

      const error = await refusalOf(api.request('/auth/me', { schema: publicUserSchema }));

      expect(error.status).toBe(502);
    });

    it('Leaves the token alone when the on-load rehydration hits the same fault', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          json(503, { code: errorCodes.INTERNAL_ERROR, message: 'Service unavailable' }),
        );
      const { api, tokens } = clientWith(fetch, 'stale-token');

      await expect(api.refresh()).rejects.toBeInstanceOf(ApiError);

      expect(tokens.get()).toBe('stale-token');
    });
  });

  describe('refresh()', () => {
    it('Stores the token it was handed, for the on-load rehydration', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(json(200, { token: 'fresh-token' }));
      const { api, tokens } = clientWith(fetch);

      await expect(api.refresh()).resolves.toBe('fresh-token');
      expect(tokens.get()).toBe('fresh-token');
    });

    it('Answers null and stays logged out when the cookie is not accepted', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          json(401, { code: errorCodes.UNAUTHORIZED, message: 'Authentication required' }),
        );
      const { api, tokens } = clientWith(fetch);

      await expect(api.refresh()).resolves.toBeNull();
      expect(tokens.get()).toBeNull();
    });

    it('Sends no body, so the bodyless POST the API expects is what it gets', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(json(200, { token: 'fresh-token' }));
      const { api } = clientWith(fetch);

      await api.refresh();

      const [path, init] = fetch.mock.calls[0] ?? [];

      expect(path).toBe(REFRESH_PATH);
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
    });
  });
});
