import { Route, Routes } from 'react-router';

import { AuthGate } from './features/auth/AuthGate';
import { routeConfig } from './routes/route-config';

export const App = () => (
  <AuthGate>
    <Routes>
      {routeConfig.map(({ path, Component }) => (
        <Route key={path} path={path} element={<Component />} />
      ))}
    </Routes>
  </AuthGate>
);
