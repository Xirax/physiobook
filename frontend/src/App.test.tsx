import type { PublicUser } from '@physiobook/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { AuthProvider } from './features/auth/AuthProvider';
import { LOGIN_PATH, ME_PATH } from './features/auth/useAuthProvider';
import type { ApiClient } from './lib/api-client';

const user: PublicUser = {
  id: '4f9d3c4e-6d4f-4a1e-9a0f-3d3f5b1c2a11',
  email: 'grace@example.com',
  full_name: 'Grace Hopper',
  role: 'user',
  created_at: '2026-08-13T09:00:00.000Z',
};

const admin: PublicUser = { ...user, email: 'admin@physiobook.local', role: 'admin' };

interface StubOptions {
  session?: PublicUser | null;
  signsInAs?: PublicUser;
  refresh?: () => Promise<string | null>;
}

const stubApi = ({ session = null, signsInAs, refresh }: StubOptions = {}) => ({
  refresh: vi.fn(refresh ?? (() => Promise.resolve(session === null ? null : 'access-token'))),

  request: vi.fn((path: string) => {
    if (path === ME_PATH) return Promise.resolve(session);

    if (path === LOGIN_PATH && signsInAs !== undefined) {
      return Promise.resolve({ user: signsInAs, token: 'access-token' });
    }

    return Promise.resolve(undefined);
  }) as unknown as ApiClient['request'],
});

const renderAt = (path: string, options: StubOptions = {}) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider api={stubApi(options) as unknown as ApiClient}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
};

const logIn = async () => {
  await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
};

describe('Landing on the root', () => {
  it('Sends a visitor with no session to the login page', async () => {
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('Sends a signed-in user to their own area', async () => {
    renderAt('/', { session: user });

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
  });

  it('Sends a signed-in admin to the admin area', async () => {
    renderAt('/', { session: admin });

    expect(await screen.findByRole('heading', { name: 'Practice admin' })).toBeInTheDocument();
  });
});

describe('The route table', () => {
  it('Serves the register page', async () => {
    renderAt('/register');

    expect(
      await screen.findByRole('heading', { name: 'Create your account' }),
    ).toBeInTheDocument();
  });

  it('Offers the way across from login to register', async () => {
    renderAt('/login');

    await screen.findByRole('heading', { name: 'Log in' });

    await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));

    expect(
      await screen.findByRole('heading', { name: 'Create your account' }),
    ).toBeInTheDocument();
  });

  it('Answers an unknown path with a not-found page', async () => {
    renderAt('/nowhere');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('Turns a signed-in visitor away from the login page', async () => {
    renderAt('/login', { session: user });

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Log in' })).not.toBeInTheDocument();
  });
});

describe('The auth-loading gate', () => {
  it('Holds every route behind a spinner until the session is settled', async () => {
    let answer = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });

    renderAt('/appointments', {
      session: user,
      refresh: async () => {
        await held;

        return 'access-token';
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session');
    expect(screen.queryByRole('heading', { name: 'Your appointments' })).not.toBeInTheDocument();

    answer();

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
  });
});

describe('Signing in through the form', () => {
  it('Lands a user in their own area', async () => {
    renderAt('/login', { signsInAs: user });

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
  });

  it('Lands an admin in the admin area, through the same form', async () => {
    renderAt('/login', { signsInAs: admin });

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    expect(await screen.findByRole('heading', { name: 'Practice admin' })).toBeInTheDocument();
  });
});
