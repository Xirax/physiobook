import type { PublicUser } from '@physiobook/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiClient } from '../../lib/api-client';
import { createTokenStore, type TokenStore } from '../../lib/auth';
import { AuthGate } from './AuthGate';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';
import { LOGIN_PATH, LOGOUT_PATH, ME_PATH, REGISTER_PATH } from './useAuthProvider';

const user: PublicUser = {
  id: '4f9d3c4e-6d4f-4a1e-9a0f-3d3f5b1c2a11',
  email: 'grace@example.com',
  full_name: 'Grace Hopper',
  role: 'user',
  created_at: '2026-08-13T09:00:00.000Z',
};

const admin: PublicUser = { ...user, id: 'a1', email: 'admin@physiobook.local', role: 'admin' };

interface StubOptions {
  refresh?: () => Promise<string | null>;
  request?: ApiClient['request'];
}

const stubApi = ({ refresh, request }: StubOptions = {}) => ({
  refresh: vi.fn(refresh ?? (() => Promise.resolve(null))),
  request: vi.fn(request ?? (() => Promise.resolve(undefined))) as unknown as ApiClient['request'],
});

const StateProbe = () => {
  const { state, login, register, logout } = useAuth();

  return (
    <div>
      <p>status: {state.status}</p>
      {state.status === 'authenticated' && <p>user: {state.user.email}</p>}
      <button
        type="button"
        onClick={() => {
          void login({ email: user.email, password: 'secret' }).catch(() => undefined);
        }}
      >
        Log in
      </button>
      <button
        type="button"
        onClick={() => {
          void register({ email: user.email, password: 'secret', full_name: user.full_name }).catch(
            () => undefined,
          );
        }}
      >
        Register
      </button>
      <button
        type="button"
        onClick={() => {
          void logout();
        }}
      >
        Log out
      </button>
    </div>
  );
};

const renderProvider = (
  api: ReturnType<typeof stubApi>,
  tokens: TokenStore = createTokenStore(),
) => {
  render(
    <AuthProvider api={api as unknown as ApiClient} tokens={tokens}>
      <StateProbe />
    </AuthProvider>,
  );

  return { tokens };
};

describe('AuthProvider', () => {
  describe('Rehydrating on load', () => {
    it('Restores the session the refresh cookie still backs', async () => {
      const api = stubApi({
        refresh: () => Promise.resolve('fresh-token'),
        request: () => Promise.resolve(user) as never,
      });

      renderProvider(api);

      expect(await screen.findByText('status: authenticated')).toBeInTheDocument();
      expect(screen.getByText(`user: ${user.email}`)).toBeInTheDocument();
    });

    it('Asks for the identity only after the credential is in hand', async () => {
      const api = stubApi({
        refresh: () => Promise.resolve('fresh-token'),
        request: () => Promise.resolve(user) as never,
      });

      renderProvider(api);

      await screen.findByText('status: authenticated');

      expect(api.refresh).toHaveBeenCalledTimes(1);
      expect(api.request).toHaveBeenCalledWith(ME_PATH, expect.anything());
    });

    it('Settles on anonymous when the cookie is not accepted', async () => {
      const api = stubApi({ refresh: () => Promise.resolve(null) });

      renderProvider(api);

      expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
      expect(api.request).not.toHaveBeenCalled();
    });

    it('Settles on anonymous, token cleared, when the identity call fails', async () => {
      const tokens = createTokenStore();
      const api = stubApi({
        refresh: () => {
          tokens.set('fresh-token');

          return Promise.resolve('fresh-token');
        },
        request: () => Promise.reject(new TypeError('Failed to fetch')) as never,
      });

      renderProvider(api, tokens);

      expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
      expect(tokens.get()).toBeNull();
    });
  });

  describe('Signing in', () => {
    it('Logs in, holds the token in memory, and reports the user', async () => {
      const tokens = createTokenStore();
      const api = stubApi({
        request: ((path: string) =>
          path === LOGIN_PATH
            ? Promise.resolve({ user, token: 'access-token' })
            : Promise.resolve(undefined)) as never,
      });

      renderProvider(api, tokens);
      await screen.findByText('status: anonymous');

      await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

      expect(await screen.findByText('status: authenticated')).toBeInTheDocument();
      expect(tokens.get()).toBe('access-token');
    });

    it('Registers straight into a session, with no second login', async () => {
      const api = stubApi({
        request: ((path: string) =>
          path === REGISTER_PATH
            ? Promise.resolve({ user, token: 'access-token' })
            : Promise.resolve(undefined)) as never,
      });

      renderProvider(api);
      await screen.findByText('status: anonymous');

      await userEvent.click(screen.getByRole('button', { name: 'Register' }));

      expect(await screen.findByText('status: authenticated')).toBeInTheDocument();
      expect(screen.getByText(`user: ${user.email}`)).toBeInTheDocument();
    });

    it('Carries the role the API reported, so an admin arrives as one', async () => {
      const api = stubApi({
        refresh: () => Promise.resolve('fresh-token'),
        request: () => Promise.resolve(admin) as never,
      });

      renderProvider(api);

      expect(await screen.findByText(`user: ${admin.email}`)).toBeInTheDocument();
    });

    it('Stays anonymous when the credentials are refused', async () => {
      const api = stubApi({
        request: (() =>
          Promise.reject(
            new ApiError(401, {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid email or password',
            }),
          )) as never,
      });

      renderProvider(api);
      await screen.findByText('status: anonymous');

      await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

      await waitFor(() => {
        expect(screen.getByText('status: anonymous')).toBeInTheDocument();
      });
    });
  });

  describe('Signing out', () => {
    it('Tells the API, drops the token, and goes anonymous', async () => {
      const tokens = createTokenStore();
      const api = stubApi({
        refresh: () => {
          tokens.set('access-token');

          return Promise.resolve('access-token');
        },
        request: ((path: string) =>
          path === ME_PATH ? Promise.resolve(user) : Promise.resolve(undefined)) as never,
      });

      renderProvider(api, tokens);
      await screen.findByText('status: authenticated');

      await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

      expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
      expect(tokens.get()).toBeNull();
      expect(api.request).toHaveBeenCalledWith(LOGOUT_PATH, { method: 'POST' });
    });

    it('Ends the session locally even when the API refuses the logout', async () => {
      const tokens = createTokenStore();
      const api = stubApi({
        refresh: () => {
          tokens.set('access-token');

          return Promise.resolve('access-token');
        },
        request: ((path: string) =>
          path === ME_PATH
            ? Promise.resolve(user)
            : Promise.reject(
                new ApiError(401, { code: 'UNAUTHORIZED', message: 'Authentication required' }),
              )) as never,
      });

      renderProvider(api, tokens);
      await screen.findByText('status: authenticated');

      await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

      expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
      expect(tokens.get()).toBeNull();
    });
  });

  describe('When a silent refresh is refused mid-session', () => {
    it('Follows the api-client clearing the token, with nobody having asked', async () => {
      const tokens = createTokenStore();
      const api = stubApi({
        refresh: () => {
          tokens.set('access-token');

          return Promise.resolve('access-token');
        },
        request: () => Promise.resolve(user) as never,
      });

      renderProvider(api, tokens);
      await screen.findByText('status: authenticated');

      tokens.clear();

      expect(await screen.findByText('status: anonymous')).toBeInTheDocument();
    });
  });
});

describe('AuthGate', () => {
  const renderGate = (api: ReturnType<typeof stubApi>) =>
    render(
      <AuthProvider api={api as unknown as ApiClient}>
        <AuthGate>
          <p>Your appointments</p>
        </AuthGate>
      </AuthProvider>,
    );

  it('Shows a spinner while the session is being restored, then the content', async () => {
    let answer = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });

    const api = stubApi({
      refresh: async () => {
        await held;

        return 'fresh-token';
      },
      request: () => Promise.resolve(user) as never,
    });

    renderGate(api);

    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session');
    expect(screen.queryByText('Your appointments')).not.toBeInTheDocument();

    answer();

    expect(await screen.findByText('Your appointments')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Releases the tree for a visitor with no session, rather than holding it', async () => {
    renderGate(stubApi({ refresh: () => Promise.resolve(null) }));

    expect(await screen.findByText('Your appointments')).toBeInTheDocument();
  });
});
