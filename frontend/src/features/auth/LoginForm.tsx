import { loginRequestSchema } from '@physiobook/shared';
import type { LoginRequest } from '@physiobook/shared';

import { TextField } from '../../components/TextField';
import { useZodForm } from '../../lib/useZodForm';
import styles from './AuthForm.module.scss';
import { describeAuthError } from './auth-errors';

export interface LoginFormProps {
  onSubmit: (values: LoginRequest) => Promise<void>;
}

export const LoginForm = ({ onSubmit }: LoginFormProps) => {
  const { fieldProps, formError, pending, handleSubmit } = useZodForm({
    schema: loginRequestSchema,
    initialValues: { email: '', password: '' },
    onSubmit,
    describeError: describeAuthError,
  });

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      <h1 className={styles.heading}>Log in</h1>

      {formError !== null && (
        <p className={styles.alert} role="alert">
          {formError}
        </p>
      )}

      <TextField label="Email" type="email" autoComplete="email" {...fieldProps('email')} />

      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        {...fieldProps('password')}
      />

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
};
