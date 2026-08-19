import type { UserRole } from '@physiobook/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useCurrentUser } from '../features/auth/useAuth';
import { homeFor, paths } from './paths';
import { returnToState } from './return-to';

export interface RequireRoleProps {
  role: UserRole;
  children: ReactNode;
}

export const RequireRole = ({ role, children }: RequireRoleProps) => {
  const user = useCurrentUser();
  const location = useLocation();

  if (user === null) return <Navigate to={paths.login} replace state={returnToState(location)} />;

  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;

  return children;
};
