import type { UserRole } from '@physiobook/shared';
import type { ComponentType } from 'react';

import { AdminHome } from './admin/AdminHome';
import { HomeRedirect } from './HomeRedirect';
import { LoginRoute } from './LoginRoute';
import { MyAppointments } from './MyAppointments';
import { NotFound } from './NotFound';
import { paths } from './paths';
import { RegisterRoute } from './RegisterRoute';

export interface AppRoute {
  path: string;
  Component: ComponentType;
  requires?: UserRole;
}

export const routeConfig: readonly AppRoute[] = [
  { path: paths.home, Component: HomeRedirect },
  { path: paths.login, Component: LoginRoute },
  { path: paths.register, Component: RegisterRoute },
  { path: paths.appointments, Component: MyAppointments, requires: 'user' },
  { path: paths.admin, Component: AdminHome, requires: 'admin' },
  { path: '*', Component: NotFound },
];
