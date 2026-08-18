import { useState } from 'react';

import { NavBar } from '../components/NavBar';
import { useAuth, useCurrentUser } from '../features/auth/useAuth';
import { navItemsFor } from './route-config';

export const AppNav = () => {
  const { logout } = useAuth();
  const user = useCurrentUser();
  const [loggingOut, setLoggingOut] = useState(false);

  if (user === null) return null;

  const handleLogout = () => {
    setLoggingOut(true);

    void logout().finally(() => {
      setLoggingOut(false);
    });
  };

  return (
    <NavBar
      items={navItemsFor(user.role)}
      userName={user.full_name}
      onLogout={handleLogout}
      loggingOut={loggingOut}
    />
  );
};
