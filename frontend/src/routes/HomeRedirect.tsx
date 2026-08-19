import { Navigate } from 'react-router';

import { useCurrentUser } from '../features/auth/useAuth';
import { homeFor, paths } from './paths';

export const HomeRedirect = () => {
  const user = useCurrentUser();

  return <Navigate to={user === null ? paths.login : homeFor(user.role)} replace />;
};
