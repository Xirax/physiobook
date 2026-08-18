import { errorCodes } from '@physiobook/shared';
import type { RegisterRequest } from '@physiobook/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { RegisterForm } from './RegisterForm';

const renderForm = (
  onSubmit: (values: RegisterRequest) => Promise<void> = () => Promise.resolve(),
) => {
  const submitted = vi.fn(onSubmit);

  render(<RegisterForm onSubmit={submitted} />);

  return {
    submitted,
    fullName: screen.getByLabelText('Full name'),
    email: screen.getByLabelText('Email'),
    password: screen.getByLabelText('Password'),
    button: screen.getByRole('button', { name: 'Create account' }),
  };
};

describe('RegisterForm validation', () => {
  it('Rejects a password shorter than the shared schema allows', async () => {
    const { password } = renderForm();

    await userEvent.type(password, 'short');
    await userEvent.tab();

    expect(await screen.findByText('Password must be at least 8 bytes long')).toBeInTheDocument();
  });

  it('Treats a name of only whitespace as no name at all', async () => {
    const { fullName } = renderForm();

    await userEvent.type(fullName, '   ');
    await userEvent.tab();

    expect(await screen.findByText('Enter your full name')).toBeInTheDocument();
  });

  it('Focuses the first field on screen, not the first the schema happens to list', async () => {
    const { fullName, button } = renderForm();

    await userEvent.click(button);

    expect(fullName).toHaveFocus();
  });
});

describe('RegisterForm submission', () => {
  it('Sends what the schema parsed, so the trimmed name is what reaches the API', async () => {
    const { submitted, fullName, email, password, button } = renderForm();

    await userEvent.type(fullName, '  Grace Hopper  ');
    await userEvent.type(email, 'grace@example.com');
    await userEvent.type(password, 'correct-horse');
    await userEvent.click(button);

    expect(submitted).toHaveBeenCalledWith({
      email: 'grace@example.com',
      password: 'correct-horse',
      full_name: 'Grace Hopper',
    });
  });

  it('Explains that the email is already spoken for', async () => {
    const { fullName, email, password, button } = renderForm(() =>
      Promise.reject(
        new ApiError(409, { code: errorCodes.EMAIL_TAKEN, message: 'email already registered' }),
      ),
    );

    await userEvent.type(fullName, 'Grace Hopper');
    await userEvent.type(email, 'grace@example.com');
    await userEvent.type(password, 'correct-horse');
    await userEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account already exists for that email. Try logging in instead.',
    );
  });
});
