import type { PublicUser } from '@physiobook/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router';
import { vi } from 'vitest';

import { App } from '../src/App';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import { LOGIN_PATH, ME_PATH, REGISTER_PATH } from '../src/features/auth/useAuthProvider';
import type { ApiClient } from '../src/lib/api-client';

export const testUser: PublicUser = {
  id: '4f9d3c4e-6d4f-4a1e-9a0f-3d3f5b1c2a11',
  email: 'grace@example.com',
  full_name: 'Grace Hopper',
  role: 'user',
  created_at: '2026-08-13T09:00:00.000Z',
};

export const testAdmin: PublicUser = {
  ...testUser,
  email: 'admin@physiobook.local',
  role: 'admin',
};

export interface AppStubOptions {
  session?: PublicUser | null;
  signsInAs?: PublicUser;
  refresh?: () => Promise<string | null>;
}

export const stubApi = ({ session = null, signsInAs, refresh }: AppStubOptions = {}) => ({
  refresh: vi.fn(refresh ?? (() => Promise.resolve(session === null ? null : 'access-token'))),

  request: vi.fn((path: string) => {
    if (path === ME_PATH) return Promise.resolve(session);

    if ((path === LOGIN_PATH || path === REGISTER_PATH) && signsInAs !== undefined) {
      return Promise.resolve({ user: signsInAs, token: 'access-token' });
    }

    return Promise.resolve(undefined);
  }) as unknown as ApiClient['request'],
});

const LocationProbe = () => {
  const location = useLocation();

  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

export const renderAppAt = (entry: InitialEntry, options: AppStubOptions = {}) => {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider api={stubApi(options) as unknown as ApiClient}>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
};

export const currentPath = () => screen.getByTestId('location').textContent;

export const logIn = async () => {
  await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
};
