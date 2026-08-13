import { describe, expect, it } from 'vitest';

import {
  hashRefreshSecret,
  mintRefreshToken,
  parseRefreshToken,
  refreshSecretMatches,
} from './refresh-token.js';

describe('refresh tokens', () => {
  const sessionId = '22222222-2222-4222-8222-222222222222';

  describe('mintRefreshToken', () => {
    it('Prefixes the value with the session it belongs to', () => {
      const { value } = mintRefreshToken(sessionId);

      expect(parseRefreshToken(value)?.sessionId).toBe(sessionId);
    });

    it('Never returns the stored hash inside the value', () => {
      const { value, hash } = mintRefreshToken(sessionId);

      expect(value).not.toContain(hash);
    });

    it('Stores a hash the secret verifies against', () => {
      const { value, hash } = mintRefreshToken(sessionId);
      const secret = parseRefreshToken(value)!.secret;

      expect(refreshSecretMatches(secret, hash)).toBe(true);
    });

    it('Is unpredictable — no two mints share a secret', () => {
      const secrets = new Set(
        Array.from(
          { length: 100 },
          () => parseRefreshToken(mintRefreshToken(sessionId).value)!.secret,
        ),
      );

      expect(secrets.size).toBe(100);
    });

    it('Carries at least 256 bits of entropy', () => {
      const secret = parseRefreshToken(mintRefreshToken(sessionId).value)!.secret;

      expect(Buffer.from(secret, 'base64url').byteLength).toBeGreaterThanOrEqual(32);
    });
  });

  describe('parseRefreshToken', () => {
    it('Splits a value into its session and its secret', () => {
      expect(parseRefreshToken(`${sessionId}.abc123`)).toEqual({ sessionId, secret: 'abc123' });
    });

    it('Rejects a value with no separator', () => {
      expect(parseRefreshToken(sessionId)).toBeUndefined();
    });

    it('Rejects a value with an empty secret', () => {
      expect(parseRefreshToken(`${sessionId}.`)).toBeUndefined();
    });

    it('Rejects a value with an empty session id', () => {
      expect(parseRefreshToken('.secret')).toBeUndefined();
    });

    it('Rejects an empty value', () => {
      expect(parseRefreshToken('')).toBeUndefined();
    });

    it('Rejects a session id that is not a uuid, which a uuid column answers with 22P02', () => {
      expect(parseRefreshToken('not-a-uuid.secret')).toBeUndefined();
    });

    it('Splits on the first separator, so a secret may contain one', () => {
      expect(parseRefreshToken(`${sessionId}.a.b`)).toEqual({ sessionId, secret: 'a.b' });
    });
  });

  describe('refreshSecretMatches', () => {
    it('Rejects a secret that is not the one issued', () => {
      const { hash } = mintRefreshToken(sessionId);

      expect(refreshSecretMatches('not-the-secret', hash)).toBe(false);
    });

    it('Rejects a stored hash of the wrong length rather than throwing', () => {
      expect(refreshSecretMatches('secret', 'ab')).toBe(false);
    });

    it('Rejects a stored hash that is not hex rather than throwing', () => {
      expect(refreshSecretMatches('secret', 'not-a-digest')).toBe(false);
    });

    it('Hashes deterministically, so a stored digest keeps matching', () => {
      expect(hashRefreshSecret('secret')).toBe(hashRefreshSecret('secret'));
    });

    it('Produces a different digest for a different secret', () => {
      expect(hashRefreshSecret('secret')).not.toBe(hashRefreshSecret('secrer'));
    });
  });
});
