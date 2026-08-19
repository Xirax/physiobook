import type { ReactNode } from 'react';

import { AuthContext } from './auth-context';
import { useAuthProvider, type UseAuthProviderOptions } from './useAuthProvider';

export interface AuthProviderProps extends UseAuthProviderOptions {
  children: ReactNode;
}

export const AuthProvider = ({ children, ...options }: AuthProviderProps) => {
  const value = useAuthProvider(options);

  return <AuthContext value={value}>{children}</AuthContext>;
};
