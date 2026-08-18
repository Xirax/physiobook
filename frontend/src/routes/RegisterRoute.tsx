import type { RegisterRequest } from '@physiobook/shared';
import { Link, Navigate } from 'react-router';

import { RegisterForm } from '../features/auth/RegisterForm';
import { useAuth, useCurrentUser } from '../features/auth/useAuth';
import styles from './AuthRoute.module.scss';
import { homeFor, paths } from './paths';

export const RegisterRoute = () => {
  const { register } = useAuth();
  const user = useCurrentUser();

  if (user !== null) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (values: RegisterRequest): Promise<void> => {
    await register(values);
  };

  return (
    <main className={styles.page}>
      <RegisterForm onSubmit={submit} />

      <p className={styles.switch}>
        Already registered? <Link to={paths.login}>Log in</Link>
      </p>
    </main>
  );
};
