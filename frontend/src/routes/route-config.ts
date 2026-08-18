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
}

export const routeConfig: readonly AppRoute[] = [
  { path: paths.home, Component: HomeRedirect },
  { path: paths.login, Component: LoginRoute },
  { path: paths.register, Component: RegisterRoute },
  { path: paths.appointments, Component: MyAppointments },
  { path: paths.admin, Component: AdminHome },
  { path: '*', Component: NotFound },
];
