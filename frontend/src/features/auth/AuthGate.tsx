import type { ReactNode } from 'react';

import { LoadingScreen } from '../../components/LoadingScreen';
import { useAuth } from './useAuth';

export interface AuthGateProps {
  children: ReactNode;
}

export const AuthGate = ({ children }: AuthGateProps) => {
  const { state } = useAuth();

  if (state.status === 'loading') return <LoadingScreen label="Restoring your session…" />;

  return children;
};
