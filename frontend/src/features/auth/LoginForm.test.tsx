import { errorCodes } from '@physiobook/shared';
import type { LoginRequest } from '@physiobook/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { LoginForm } from './LoginForm';

const renderForm = (
  onSubmit: (values: LoginRequest) => Promise<void> = () => Promise.resolve(),
) => {
  const submitted = vi.fn(onSubmit);

  render(<LoginForm onSubmit={submitted} />);

  return {
    submitted,
    email: screen.getByLabelText('Email'),
    password: screen.getByLabelText('Password'),
    button: screen.getByRole('button', { name: 'Log in' }),
  };
};

const fillValid = async (email: HTMLElement, password: HTMLElement) => {
  await userEvent.type(email, 'grace@example.com');
  await userEvent.type(password, 'correct-horse');
};

describe('LoginForm validation', () => {
  it('Says nothing about a field the user has not finished with', async () => {
    const { email } = renderForm();

    await userEvent.type(email, 'nope');

    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
  });

  it('Shows the shared schema’s own message once the field is left', async () => {
    const { email } = renderForm();

    await userEvent.type(email, 'nope');
    await userEvent.tab();

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('Takes the message back as soon as the value becomes valid', async () => {
    const { email } = renderForm();

    await userEvent.type(email, 'nope');
    await userEvent.tab();
    await screen.findByText('Enter a valid email address');

    await userEvent.type(email, '@example.com');

    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
  });

  it('Refuses an invalid submit and reports every field at once', async () => {
    const { submitted, button } = renderForm();

    await userEvent.click(button);

    expect(submitted).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
  });

  it('Moves focus to the first field that needs fixing', async () => {
    const { email, button } = renderForm();

    await userEvent.click(button);

    expect(email).toHaveFocus();
  });

  it('Skips past the fields that are already fine when placing that focus', async () => {
    const { email, password, button } = renderForm();

    await userEvent.type(email, 'grace@example.com');
    await userEvent.click(button);

    expect(password).toHaveFocus();
  });

  it('Marks the input invalid and describes it with the message', async () => {
    const { email } = renderForm();

    await userEvent.type(email, 'nope');
    await userEvent.tab();
    await screen.findByText('Enter a valid email address');

    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter a valid email address');
  });
});

describe('LoginForm submission', () => {
  it('Sends the parsed values once every field passes', async () => {
    const { submitted, email, password, button } = renderForm();

    await fillValid(email, password);
    await userEvent.click(button);

    expect(submitted).toHaveBeenCalledWith({
      email: 'grace@example.com',
      password: 'correct-horse',
    });
  });

  it('Holds the button shut while the request is in flight', async () => {
    let settle = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      settle = resolve;
    });

    const { email, password, button } = renderForm(() => held);

    await fillValid(email, password);
    await userEvent.click(button);

    expect(await screen.findByRole('button', { name: 'Logging in…' })).toBeDisabled();

    settle();

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeEnabled();
  });
});

describe('LoginForm when the API refuses', () => {
  const refuseWith = (error: unknown) => () => Promise.reject(error);

  it('Names the refusal by its code, not by the prose the API sent', async () => {
    const { email, password, button } = renderForm(
      refuseWith(
        new ApiError(401, {
          code: errorCodes.INVALID_CREDENTIALS,
          message: 'invalid email or password',
        }),
      ),
    );

    await fillValid(email, password);
    await userEvent.click(button);

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('That email and password do not match an account.');
    expect(alert).not.toHaveTextContent('invalid email or password');
  });

  it('Puts a field error the API named onto the field it named', async () => {
    const { email, password, button } = renderForm(
      refuseWith(
        new ApiError(400, {
          code: errorCodes.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: [{ path: 'email', message: 'That address is not allowed' }],
        }),
      ),
    );

    await fillValid(email, password);
    await userEvent.click(button);

    await screen.findByRole('alert');

    expect(email).toHaveAccessibleDescription('That address is not allowed');
  });

  it('Drops that field error once the value it complained about is edited', async () => {
    const { email, password, button } = renderForm(
      refuseWith(
        new ApiError(400, {
          code: errorCodes.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: [{ path: 'email', message: 'That address is not allowed' }],
        }),
      ),
    );

    await fillValid(email, password);
    await userEvent.click(button);
    await screen.findByText('That address is not allowed');

    await userEvent.type(email, 'x');

    expect(screen.queryByText('That address is not allowed')).not.toBeInTheDocument();
  });

  it('Blames the connection when the request never reached the API', async () => {
    const { email, password, button } = renderForm(refuseWith(new TypeError('Failed to fetch')));

    await fillValid(email, password);
    await userEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
  });

  it('Lets the form be tried again', async () => {
    const { email, password, button } = renderForm(
      refuseWith(
        new ApiError(401, {
          code: errorCodes.INVALID_CREDENTIALS,
          message: 'invalid email or password',
        }),
      ),
    );

    await fillValid(email, password);
    await userEvent.click(button);
    await screen.findByRole('alert');

    expect(button).toBeEnabled();
  });
});
