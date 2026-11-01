import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNow } from './useNow';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-01T22:59:30Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Starts at the time it was mounted', () => {
    const { result } = renderHook(() => useNow(60_000));

    expect(result.current.toISOString()).toBe('2026-11-01T22:59:30.000Z');
  });

  it('Moves on once the interval passes, so a page left open crosses midnight', () => {
    const { result } = renderHook(() => useNow(60_000));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.toISOString()).toBe('2026-11-01T23:00:30.000Z');
  });

  it('Stops the clock when unmounted', () => {
    const { unmount } = renderHook(() => useNow(60_000));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
