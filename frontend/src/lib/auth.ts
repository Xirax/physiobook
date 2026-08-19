export interface TokenStore {
  get: () => string | null;
  set: (token: string) => void;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
}

/**
 * The access token, held in memory and nowhere else.
 *
 * Not `localStorage`: a token readable by any script on the origin survives the
 * tab that earned it, and there is nothing to gain from persisting one that
 * expires in fifteen minutes when the httpOnly refresh cookie already restores
 * the session on load (PROJECT_STRUCTURE.md §3).
 *
 * `subscribe` exists so the AuthProvider learns when the api-client clears the
 * token after a refusal it did not initiate. That keeps the redirect in the
 * route guards, where every other unauthenticated case is already handled,
 * instead of giving a lib module a way to navigate.
 */
export function createTokenStore(): TokenStore {
  let token: string | null = null;
  const listeners = new Set<() => void>();

  const announce = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    get: () => token,

    set: (next) => {
      if (next === token) return;

      token = next;
      announce();
    },

    clear: () => {
      if (token === null) return;

      token = null;
      announce();
    },

    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
