import type { LoginRequest } from '@physiobook/shared';
import { Link, Navigate, useLocation } from 'react-router';

import { LoginForm } from '../features/auth/LoginForm';
import { useAuth, useCurrentUser } from '../features/auth/useAuth';
import styles from './AuthRoute.module.scss';
import { homeFor, paths } from './paths';
import { returnToFrom } from './return-to';

export const LoginRoute = () => {
  const { login } = useAuth();
  const user = useCurrentUser();
  const location = useLocation();

  if (user !== null) {
    return <Navigate to={returnToFrom(location.state) ?? homeFor(user.role)} replace />;
  }

  const submit = async (values: LoginRequest): Promise<void> => {
    await login(values);
  };

  return (
    <main className={styles.page}>
      <LoginForm onSubmit={submit} />

      <p className={styles.switch}>
        New here? <Link to={paths.register} state={location.state}> Create an account </Link>
      </p>
    </main>
  );
};
