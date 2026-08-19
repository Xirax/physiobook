import { describe, expect, it, vi } from 'vitest';

import { createTokenStore } from './auth';

describe('createTokenStore', () => {
  it('Starts empty', () => {
    expect(createTokenStore().get()).toBeNull();
  });

  it('Hands back the token it was given', () => {
    const tokens = createTokenStore();

    tokens.set('access-token');

    expect(tokens.get()).toBe('access-token');
  });

  it('Announces a change to its subscribers', () => {
    const tokens = createTokenStore();
    const listener = vi.fn();

    tokens.subscribe(listener);
    tokens.set('access-token');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('Stays silent when the token is set to the value it already holds', () => {
    const tokens = createTokenStore();
    const listener = vi.fn();

    tokens.set('access-token');
    tokens.subscribe(listener);
    tokens.set('access-token');

    expect(listener).not.toHaveBeenCalled();
  });

  it('Announces the clear that ends a session', () => {
    const tokens = createTokenStore();
    const listener = vi.fn();

    tokens.set('access-token');
    tokens.subscribe(listener);
    tokens.clear();

    expect(tokens.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('Stays silent clearing a store that is already empty', () => {
    const tokens = createTokenStore();
    const listener = vi.fn();

    tokens.subscribe(listener);
    tokens.clear();

    expect(listener).not.toHaveBeenCalled();
  });

  it('Stops announcing to a listener that unsubscribed', () => {
    const tokens = createTokenStore();
    const listener = vi.fn();

    tokens.subscribe(listener)();
    tokens.set('access-token');

    expect(listener).not.toHaveBeenCalled();
  });

  it('Survives a listener that unsubscribes while being announced to', () => {
    const tokens = createTokenStore();
    const second = vi.fn();

    const unsubscribeFirst = tokens.subscribe(() => {
      unsubscribeFirst();
    });
    tokens.subscribe(second);

    expect(() => {
      tokens.set('access-token');
    }).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('Keeps two stores independent', () => {
    const first = createTokenStore();
    const second = createTokenStore();

    first.set('first-token');

    expect(second.get()).toBeNull();
  });
});
