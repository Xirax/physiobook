import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useCurrentUser } from './useAuth';

/** Whatever one session fetched must not be on screen for whoever signs in next. */
export function useClearServerStateOnSignOut(): void {
  const queryClient = useQueryClient();
  const userId = useCurrentUser()?.id;

  useEffect(() => {
    if (userId === undefined) queryClient.clear();
  }, [queryClient, userId]);
}
