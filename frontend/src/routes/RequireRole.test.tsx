import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { currentPath, logIn, renderAppAt, testAdmin, testUser } from '../../tests/render-app';

describe('Guarding a route from a visitor with no session', () => {
  it('Sends them to the login page instead of the page they asked for', async () => {
    renderAppAt('/appointments');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your appointments' })).not.toBeInTheDocument();
  });

  it('Guards the admin area the same way', async () => {
    renderAppAt('/admin');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Practice admin' })).not.toBeInTheDocument();
  });

  it('Never flashes the login page while the session is still being restored', async () => {
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

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Log in' })).not.toBeInTheDocument();

    answer();

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
  });
});

describe('Returning to the intended destination', () => {
  it('Carries the visitor on to the exact page that turned them away', async () => {
    renderAppAt('/appointments?tab=past', { signsInAs: testUser });

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    await screen.findByRole('heading', { name: 'Your appointments' });

    expect(currentPath()).toBe('/appointments?tab=past');
  });

  it('Keeps that destination when the visitor crosses to register first', async () => {
    renderAppAt('/appointments?tab=past', { signsInAs: testUser });

    await screen.findByRole('heading', { name: 'Log in' });
    await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));
    await screen.findByRole('heading', { name: 'Create your account' });

    await userEvent.type(screen.getByLabelText('Full name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByRole('heading', { name: 'Your appointments' });

    expect(currentPath()).toBe('/appointments?tab=past');
  });

  it('Falls back to the role’s own area when nowhere was intended', async () => {
    renderAppAt('/login', { signsInAs: testUser });

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    await screen.findByRole('heading', { name: 'Your appointments' });

    expect(currentPath()).toBe('/appointments');
  });

  it('Ignores a destination that would leave the app', async () => {
    renderAppAt(
      { pathname: '/login', state: { from: 'https://evil.example/steal' } },
      { signsInAs: testUser },
    );

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    await screen.findByRole('heading', { name: 'Your appointments' });

    expect(currentPath()).toBe('/appointments');
  });

  it('Ignores a protocol-relative destination, which a lone leading slash would allow', async () => {
    renderAppAt(
      { pathname: '/login', state: { from: '//evil.example/steal' } },
      { signsInAs: testUser },
    );

    await screen.findByRole('heading', { name: 'Log in' });
    await logIn();

    await screen.findByRole('heading', { name: 'Your appointments' });

    expect(currentPath()).toBe('/appointments');
  });
});

describe('Guarding a route from the wrong role', () => {
  it('Sends a user who wanders into the admin area back to their own', async () => {
    renderAppAt('/admin', { session: testUser });

    expect(await screen.findByRole('heading', { name: 'Your appointments' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Practice admin' })).not.toBeInTheDocument();
  });

  it('Sends an admin who wanders into the user area back to the admin area', async () => {
    renderAppAt('/appointments', { session: testAdmin });

    expect(await screen.findByRole('heading', { name: 'Practice admin' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your appointments' })).not.toBeInTheDocument();
  });

  it('Lets the role the route asks for through', async () => {
    renderAppAt('/admin', { session: testAdmin });

    expect(await screen.findByRole('heading', { name: 'Practice admin' })).toBeInTheDocument();
  });
});
