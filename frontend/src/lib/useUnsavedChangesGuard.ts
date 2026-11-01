import { useEffect } from 'react';

/**
 * Asks the browser to confirm a reload, tab close or navigation away from the
 * app while there are unsaved edits.
 *
 * Deliberately `beforeunload` only: navigation *inside* the SPA (a nav link) is
 * not guarded. React Router's `useBlocker` needs a data router, and the app
 * mounts a `<BrowserRouter>`; migrating was weighed and declined for 2.4 (see
 * the ticket's AS-BUILT note in docs/BACKLOG.csv).
 */
export function useUnsavedChangesGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Still required by Chromium-based browsers before they show the prompt.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', warn);

    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
}
