import type { UserRole } from '@physiobook/shared';
import type { ComponentType } from 'react';

import type { NavItem } from '../components/NavBar';

import { AdminAvailability } from './admin/AdminAvailability';
import { AdminHome } from './admin/AdminHome';
import { BookAppointment } from './BookAppointment';
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
  navLabel?: string;
}

export const routeConfig: readonly AppRoute[] = [
  { path: paths.home, Component: HomeRedirect },
  { path: paths.login, Component: LoginRoute },
  { path: paths.register, Component: RegisterRoute },
  {
    path: paths.myAppointments,
    Component: MyAppointments,
    requires: 'user',
    navLabel: 'Appointments',
  },
  { path: paths.book, Component: BookAppointment, requires: 'user', navLabel: 'Book' },
  { path: paths.admin, Component: AdminHome, requires: 'admin', navLabel: 'Dashboard' },
  {
    path: paths.adminAvailability,
    Component: AdminAvailability,
    requires: 'admin',
    navLabel: 'Availability',
  },
  { path: '*', Component: NotFound },
];

export function navItemsFor(role: UserRole): NavItem[] {
  const items: NavItem[] = [];

  for (const { path, navLabel, requires } of routeConfig) {
    if (navLabel !== undefined && requires === role) items.push({ path, label: navLabel });
  }

  return items;
}
