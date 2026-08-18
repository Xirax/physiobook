import type { Location } from 'react-router';

export interface ReturnToState {
  from: string;
}

export function returnToState(location: Location): ReturnToState {
  return { from: `${location.pathname}${location.search}` };
}

export function returnToFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null;

  const { from } = state;

  if (typeof from !== 'string') return null;

  // `//host` is protocol-relative: a leading slash alone would still leave the app.
  return from.startsWith('/') && !from.startsWith('//') ? from : null;
}
