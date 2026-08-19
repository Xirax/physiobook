import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { logIn, renderAppAt, testAdmin, testUser } from '../tests/render-app';

describe('Landing on the root', () => {
  it('Sends a visitor with no session to the login page', async () => {
    renderAppAt('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('Sends a signed-in user to their own area', async () => {
    renderAppAt('/', { session: testUser });

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
  });

  it('Sends a signed-in admin to the admin area', async () => {
    renderAppAt('/', { session: testAdmin });

    expect(await screen.findByRole('heading', { name: 'Practice admin' })).toBeInTheDocument();
  });
});

describe('The route table', () => {
  it('Serves the register page', async () => {
    renderAppAt('/register');

    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('Offers the way across from login to register', async () => {
    renderAppAt('/login');

    await screen.findByRole('heading', { name: 'Log in' });

    await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));

    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('Answers an unknown path with a not-found page', async () => {
    renderAppAt('/nowhere');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('Turns a signed-in visitor away from the login page', async () => {
    renderAppAt('/login', { session: testUser });

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

    renderAppAt('/appointments', {
      session: testUser,
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
    renderAppAt('/login', { signsInAs: testUser });

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
  });

  it('Lands an admin in the admin area, through the same form', async () => {
    renderAppAt('/login', { signsInAs: testAdmin });

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    expect(await screen.findByRole('heading', { name: 'Practice admin' })).toBeInTheDocument();
  });
});
