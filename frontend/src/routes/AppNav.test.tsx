import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LOGOUT_PATH } from '../features/auth/useAuthProvider';
import { currentPath, renderAppAt, testAdmin, testUser } from '../../tests/render-app';

describe('The nav a role is given', () => {
  it('Offers a user their own area and nothing of the admin’s', async () => {
    renderAppAt('/appointments', { session: testUser });

    expect(await screen.findByRole('link', { name: 'Appointments' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('Offers an admin their own area and nothing of the user’s', async () => {
    renderAppAt('/admin', { session: testAdmin });

    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Appointments' })).not.toBeInTheDocument();
  });

  it('Names the person who is signed in', async () => {
    renderAppAt('/appointments', { session: testUser });

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
  });

  it('Marks the page the visitor is on', async () => {
    renderAppAt('/appointments', { session: testUser });

    expect(await screen.findByRole('link', { name: 'Appointments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('Shows no nav at all to a visitor with no session', async () => {
    renderAppAt('/login');

    await screen.findByRole('heading', { name: 'Log in' });

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });
});

describe('Logging out', () => {
  it('Tells the API, then leaves the app logged out at the login page', async () => {
    const { api } = renderAppAt('/appointments', { session: testUser });

    await screen.findByRole('heading', { name: 'Your appointments' });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(api.request).toHaveBeenCalledWith(LOGOUT_PATH, { method: 'POST' });
    expect(currentPath()).toBe('/login');
  });

  it('Takes the nav away with it', async () => {
    renderAppAt('/appointments', { session: testUser });

    await screen.findByRole('heading', { name: 'Your appointments' });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('heading', { name: 'Log in' });

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('Drops everything the session fetched, so the next sign-in starts clean', async () => {
    const { queryClient } = renderAppAt('/admin', { session: testAdmin });

    await screen.findByRole('heading', { name: 'Practice admin' });
    queryClient.setQueryData(['business-hours'], { windows: [] });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: 'Log in' });

    expect(queryClient.getQueryData(['business-hours'])).toBeUndefined();
  });

  it('Sends an admin back to the login page just the same', async () => {
    renderAppAt('/admin', { session: testAdmin });

    await screen.findByRole('heading', { name: 'Practice admin' });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});
