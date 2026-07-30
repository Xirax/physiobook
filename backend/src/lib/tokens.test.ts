import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { signAccessToken, verifyAccessToken } from './tokens.js';

describe('access tokens', () => {
  const secret = 'a-test-secret-long-enough-for-hs256-use';
  const user = { id: '11111111-1111-4111-8111-111111111111', role: 'user' } as const;

  const at = (iso: string) => () => new Date(iso);

  describe('signAccessToken', () => {
    it('Puts the user id in sub and the role alongside it', () => {
      const claims = verifyAccessToken(signAccessToken(user, { secret, ttlSeconds: 900 }), secret);

      expect(claims.sub).toBe(user.id);
      expect(claims.role).toBe('user');
    });

    it('Computes exp from the injected clock and the TTL', () => {
      const signedAt = '2026-07-29T10:00:00Z';
      const issuedAt = Math.floor(Date.parse(signedAt) / 1000);

      const claims = verifyAccessToken(
        signAccessToken(user, { secret, ttlSeconds: 900, now: at(signedAt) }),
        secret,
        { now: at(signedAt) },
      );

      expect(claims.iat).toBe(issuedAt);
      expect(claims.exp).toBe(issuedAt + 900);
    });

    it('carries the admin role through unchanged', () => {
      const token = signAccessToken({ id: user.id, role: 'admin' }, { secret, ttlSeconds: 900 });

      expect(verifyAccessToken(token, secret).role).toBe('admin');
    });
  });

  describe('verifyAccessToken', () => {
    it('rejects a token signed with a different secret', () => {
      const token = signAccessToken(user, {
        secret: 'a-completely-different-signing-secret',
        ttlSeconds: 900,
      });

      expect(() => verifyAccessToken(token, secret)).toThrow(jwt.JsonWebTokenError);
    });

    it('Rejects a tampered payload', () => {
      const token = signAccessToken(user, { secret, ttlSeconds: 900 });
      const [header, payload, signature] = token.split('.');

      const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as {
        role: string;
      };
      decoded.role = 'admin';
      const forged = [
        header,
        Buffer.from(JSON.stringify(decoded)).toString('base64url'),
        signature,
      ].join('.');

      expect(() => verifyAccessToken(forged, secret)).toThrow(jwt.JsonWebTokenError);
    });

    it('Rejects a token whose expiry has passed', () => {
      const token = signAccessToken(user, {
        secret,
        ttlSeconds: 900,
        now: at('2026-07-29T10:00:00Z'),
      });

      expect(() => verifyAccessToken(token, secret, { now: at('2026-07-29T10:16:00Z') })).toThrow(
        jwt.TokenExpiredError,
      );
    });

    it('Accepts the same token one second before it expires', () => {
      const token = signAccessToken(user, {
        secret,
        ttlSeconds: 900,
        now: at('2026-07-29T10:00:00Z'),
      });

      expect(verifyAccessToken(token, secret, { now: at('2026-07-29T10:14:59Z') }).sub).toBe(
        user.id,
      );
    });

    it('Rejects an unsigned token', () => {
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      )}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'admin' })).toString('base64url')}.`;

      expect(() => verifyAccessToken(unsigned, secret)).toThrow(jwt.JsonWebTokenError);
    });

    it('Rejects a token whose role is not one this app knows', () => {
      const token = jwt.sign({ role: 'superuser' }, secret, {
        algorithm: 'HS256',
        subject: user.id,
        expiresIn: 900,
      });

      expect(() => verifyAccessToken(token, secret)).toThrow(/unknown role/);
    });

    it('Rejects a token with no sub', () => {
      const token = jwt.sign({ role: 'user' }, secret, { algorithm: 'HS256', expiresIn: 900 });

      expect(() => verifyAccessToken(token, secret)).toThrow(/missing required claims/);
    });

    it('Rejects a token with no expiry', () => {
      const token = jwt.sign({ role: 'user' }, secret, { algorithm: 'HS256', subject: user.id });

      expect(() => verifyAccessToken(token, secret)).toThrow(/missing required claims/);
    });

    it('Rejects a string payload', () => {
      const token = jwt.sign('just a string', secret, { algorithm: 'HS256' });

      expect(() => verifyAccessToken(token, secret)).toThrow(/not an object/);
    });
  });
});
