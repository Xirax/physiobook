import { authResponseSchema, publicUserSchema } from '@physiobook/shared';
import type { LoginRequest, PublicUser, RegisterRequest } from '@physiobook/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createApiClient, type ApiClient } from '../../lib/api-client';
import { createTokenStore, type TokenStore } from '../../lib/auth';
import type { AuthContextValue, AuthState } from './auth-context';

export const ME_PATH = '/auth/me';
export const LOGIN_PATH = '/auth/login';
export const REGISTER_PATH = '/auth/register';
export const LOGOUT_PATH = '/auth/logout';

export interface UseAuthProviderOptions {
  tokens?: TokenStore;
  api?: ApiClient;
}

/** Everything the <AuthProvider> puts on the context; the component only mounts it. */
export function useAuthProvider({ tokens, api }: UseAuthProviderOptions = {}): AuthContextValue {
  const [store, client] = useMemo((): [TokenStore, ApiClient] => {
    const resolvedStore = tokens ?? createTokenStore();

    return [resolvedStore, api ?? createApiClient({ tokens: resolvedStore })];
  }, [tokens, api]);

  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let current = true;

    const rehydrate = async (): Promise<AuthState> => {
      if ((await client.refresh()) === null) return { status: 'anonymous' };

      return {
        status: 'authenticated',
        user: await client.request(ME_PATH, { schema: publicUserSchema }),
      };
    };

    void rehydrate()
      .catch((): AuthState => {
        store.clear();

        return { status: 'anonymous' };
      })
      .then((resolved) => {
        if (current) setState(resolved);
      });

    return () => {
      current = false;
    };
  }, [client, store]);

  useEffect(
    () =>
      store.subscribe(() => {
        if (store.get() !== null) return;

        setState((previous) =>
          previous.status === 'authenticated' ? { status: 'anonymous' } : previous,
        );
      }),
    [store],
  );

  const startSession = useCallback(
    async (path: string, body: LoginRequest | RegisterRequest): Promise<PublicUser> => {
      const { user, token } = await client.request(path, {
        method: 'POST',
        body,
        schema: authResponseSchema,
      });

      store.set(token);
      setState({ status: 'authenticated', user });

      return user;
    },
    [client, store],
  );

  const register = useCallback(
    (input: RegisterRequest) => startSession(REGISTER_PATH, input),
    [startSession],
  );

  const login = useCallback(
    (input: LoginRequest) => startSession(LOGIN_PATH, input),
    [startSession],
  );

  const logout = useCallback(async () => {
    await client.request(LOGOUT_PATH, { method: 'POST' }).catch(() => undefined);

    store.clear();
    setState({ status: 'anonymous' });
  }, [client, store]);

  return useMemo(
    () => ({ state, api: client, register, login, logout }),
    [state, client, register, login, logout],
  );
}
