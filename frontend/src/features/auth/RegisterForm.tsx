import { registerRequestSchema } from '@physiobook/shared';
import type { RegisterRequest } from '@physiobook/shared';

import { TextField } from '../../components/TextField';
import { useZodForm } from '../../lib/useZodForm';
import styles from './AuthForm.module.scss';
import { describeAuthError } from './auth-errors';

export interface RegisterFormProps {
  onSubmit: (values: RegisterRequest) => Promise<void>;
}

export const RegisterForm = ({ onSubmit }: RegisterFormProps) => {
  const { fieldProps, formError, pending, handleSubmit } = useZodForm({
    schema: registerRequestSchema,
    initialValues: { email: '', password: '', full_name: '' },
    onSubmit,
    describeError: describeAuthError,
  });

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      <h1 className={styles.heading}>Create your account</h1>

      {formError !== null && (
        <p className={styles.alert} role="alert">
          {formError}
        </p>
      )}

      <TextField label="Full name" autoComplete="name" {...fieldProps('full_name')} />

      <TextField label="Email" type="email" autoComplete="email" {...fieldProps('email')} />

      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        {...fieldProps('password')}
      />

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'}
      </button>
    </form>
  );
};
