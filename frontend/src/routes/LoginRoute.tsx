import type { LoginRequest } from '@physiobook/shared';
import { Link, Navigate } from 'react-router';

import { LoginForm } from '../features/auth/LoginForm';
import { useAuth, useCurrentUser } from '../features/auth/useAuth';
import styles from './AuthRoute.module.scss';
import { homeFor, paths } from './paths';

export const LoginRoute = () => {
  const { login } = useAuth();
  const user = useCurrentUser();

  if (user !== null) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (values: LoginRequest): Promise<void> => {
    await login(values);
  };

  return (
    <main className={styles.page}>
      <LoginForm onSubmit={submit} />

      <p className={styles.switch}>
        New here? <Link to={paths.register}>Create an account</Link>
      </p>
    </main>
  );
};
