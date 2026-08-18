import type { UserRole } from '@physiobook/shared';

export const paths = {
  home: '/',
  login: '/login',
  register: '/register',
  appointments: '/appointments',
  admin: '/admin',
} as const;

export function homeFor(role: UserRole): string {
  return role === 'admin' ? paths.admin : paths.appointments;
}
