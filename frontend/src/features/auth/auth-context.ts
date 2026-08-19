import type { LoginRequest, PublicUser, RegisterRequest } from '@physiobook/shared';
import { createContext } from 'react';

import type { ApiClient } from '../../lib/api-client';

export type AuthState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; user: PublicUser };

export interface AuthContextValue {
  state: AuthState;
  api: ApiClient;
  register: (input: RegisterRequest) => Promise<PublicUser>;
  login: (input: LoginRequest) => Promise<PublicUser>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
