import { useContext } from 'react';

import type { ApiClient } from '../../lib/api-client';
import { AuthContext, type AuthContextValue } from './auth-context';

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (value === null) throw new Error('useAuth must be used inside an <AuthProvider>');

  return value;
}

export function useApi(): ApiClient {
  return useAuth().api;
}
