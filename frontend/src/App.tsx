import { Route, Routes } from 'react-router';

import { AuthGate } from './features/auth/AuthGate';
import { AppNav } from './routes/AppNav';
import { RequireRole } from './routes/RequireRole';
import { routeConfig, type AppRoute } from './routes/route-config';

const elementFor = ({ Component, requires }: AppRoute) =>
  requires === undefined ? (
    <Component />
  ) : (
    <RequireRole role={requires}>
      <Component />
    </RequireRole>
  );

export const App = () => (
  <AuthGate>
    <AppNav />

    <Routes>
      {routeConfig.map((route) => (
        <Route key={route.path} path={route.path} element={elementFor(route)} />
      ))}
    </Routes>
  </AuthGate>
);
