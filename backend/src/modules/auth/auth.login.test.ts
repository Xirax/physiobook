import { sessions, users } from '@physiobook/db';
import { errorCodes } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  TEST_JWT_SECRET,
  TEST_JWT_TTL_SECONDS,
  TEST_REFRESH_TTL_SECONDS,
} from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { hashRefreshSecret, parseRefreshToken } from '../../lib/refresh-token.js';
import { verifyAccessToken } from '../../lib/tokens.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../plugins/cookie.js';
import { BCRYPT_COST, DUMMY_PASSWORD_HASH } from './auth.service.js';

describe('POST /auth/login', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  const account = {
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    full_name: 'Ada Lovelace',
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString });

    await app.inject({ method: 'POST', url: '/auth/register', payload: account });
    await database.db.delete(sessions);
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  const login = (
    payload: NonNullable<InjectOptions['payload']>,
    instance: FastifyInstance = app,
  ): Promise<LightMyRequestResponse> =>
    instance.inject({ method: 'POST', url: '/auth/login', payload });

  const credentials = { email: account.email, password: account.password };

  const refreshCookieOf = (response: LightMyRequestResponse) =>
    response.cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME);

  const sessionsOf = (userId: string) =>
    database.db.select().from(sessions).where(eq(sessions.userId, userId));

  const idOf = async (email: string): Promise<string> => {
    const [row] = await database.db.select().from(users).where(eq(users.email, email));

    return row!.id;
  };

  describe('Correct credentials', () => {
    it('Returns 201 with the user and a token', async () => {
      const response = await login(credentials);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        user: {
          id: expect.any(String),
          email: account.email,
          full_name: account.full_name,
          role: 'user',
          created_at: expect.any(String),
        },
        token: expect.any(String),
      });
    });

    it('Creates exactly one session', async () => {
      await database.db.delete(sessions);
      await login(credentials);

      const rows = await sessionsOf(await idOf(account.email));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.revokedAt).toBeNull();
    });

    it('Issues a token whose claims name the user, the role and the session', async () => {
      const response = await login(credentials);
      const { user, token } = response.json();

      const claims = verifyAccessToken(token, TEST_JWT_SECRET);
      const rows = await sessionsOf(user.id);

      expect(claims.sub).toBe(user.id);
      expect(claims.role).toBe('user');
      expect(rows.map((row) => row.id)).toContain(claims.session_id);
    });

    it('Expires the token in 15 minutes', async () => {
      const { token } = (await login(credentials)).json();
      const claims = verifyAccessToken(token, TEST_JWT_SECRET);

      expect(claims.exp - claims.iat).toBe(TEST_JWT_TTL_SECONDS);
    });

    it('Matches on an address that differs only in case', async () => {
      const response = await login({ ...credentials, email: 'ADA@Example.COM' });

      expect(response.statusCode).toBe(201);
      expect(response.json().user.email).toBe(account.email);
    });

    it('Carries the admin role for the admin account', async () => {
      const response = await login({
        email: 'admin@physiobook.local',
        password: 'ChangeMe123!',
      });

      expect(response.statusCode).toBe(201);
      expect(verifyAccessToken(response.json().token, TEST_JWT_SECRET).role).toBe('admin');
    });

    it('Opens a separate session for each login', async () => {
      const first = await login(credentials);
      const second = await login(credentials);

      const claimsOf = (response: LightMyRequestResponse) =>
        verifyAccessToken(response.json().token, TEST_JWT_SECRET).session_id;

      expect(claimsOf(first)).not.toBe(claimsOf(second));
      expect(refreshCookieOf(first)?.value).not.toBe(refreshCookieOf(second)?.value);
    });
  });

  describe('The refresh cookie', () => {
    it('Is set, httpOnly, SameSite=Strict and scoped to the auth routes', async () => {
      const cookie = refreshCookieOf(await login(credentials));

      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toMatch(/strict/i);
      expect(cookie?.path).toBe(REFRESH_COOKIE_PATH);
      expect(cookie?.maxAge).toBe(TEST_REFRESH_TTL_SECONDS);
    });

    it('References the session the token was issued against', async () => {
      const response = await login(credentials);
      const parsed = parseRefreshToken(refreshCookieOf(response)!.value);

      expect(parsed?.sessionId).toBe(
        verifyAccessToken(response.json().token, TEST_JWT_SECRET).session_id,
      );
    });

    it('Leaves only a hash behind, never the secret itself', async () => {
      const response = await login(credentials);
      const { sessionId, secret } = parseRefreshToken(refreshCookieOf(response)!.value)!;

      const [row] = await database.db.select().from(sessions).where(eq(sessions.id, sessionId));

      expect(row?.tokenHash).toBe(hashRefreshSecret(secret));
      expect(row?.tokenHash).not.toContain(secret);
    });

    it('Is not Secure on a plain-http origin, where the browser would drop it', async () => {
      expect(refreshCookieOf(await login(credentials))?.secure).toBeFalsy();
    });

    it('Is Secure when the server is configured for production', async () => {
      const secureApp = await buildTestApp({
        databaseUrl: database.connectionString,
        secureCookies: true,
      });

      try {
        expect(refreshCookieOf(await login(credentials, secureApp))?.secure).toBe(true);
      } finally {
        await secureApp.close();
      }
    });

    it('Never appears in the response body', async () => {
      const response = await login(credentials);
      const { secret } = parseRefreshToken(refreshCookieOf(response)!.value)!;

      expect(response.body).not.toContain(secret);
    });
  });

  describe('Rejected credentials', () => {
    const unknown = { email: 'nobody@example.com', password: account.password };
    const wrongPassword = { email: account.email, password: 'not-the-right-password' };

    it('Answers 401 for a wrong password', async () => {
      const response = await login(wrongPassword);

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.INVALID_CREDENTIALS);
    });

    it('Answers 401 for an address nobody owns', async () => {
      const response = await login(unknown);

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.INVALID_CREDENTIALS);
    });

    it('Answers the two with an identical body, so neither reveals which failed', async () => {
      const [missing, wrong] = await Promise.all([login(unknown), login(wrongPassword)]);

      expect(missing.statusCode).toBe(wrong.statusCode);
      expect(missing.body).toBe(wrong.body);
    });

    it('Does not echo the address back to the caller', async () => {
      const response = await login(unknown);

      expect(response.body).not.toContain('nobody@example.com');
    });

    it('Opens no session and sets no cookie', async () => {
      await database.db.delete(sessions);
      const response = await login(wrongPassword);

      expect(await database.db.select().from(sessions)).toHaveLength(0);
      expect(refreshCookieOf(response)).toBeUndefined();
    });

    it('Compares against a hash of the same cost when the account does not exist', () => {
      expect(DUMMY_PASSWORD_HASH).toMatch(new RegExp(`^\\$2[aby]\\$${String(BCRYPT_COST)}\\$`));
    });

    it('Cannot be logged into with the dummy hash itself', async () => {
      const response = await login({ ...credentials, password: DUMMY_PASSWORD_HASH });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Validation', () => {
    const expectValidationFailure = (response: LightMyRequestResponse) => {
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
    };

    it('Rejects a missing password', async () => {
      expectValidationFailure(await login({ email: account.email }));
    });

    it('Rejects a missing email', async () => {
      expectValidationFailure(await login({ password: account.password }));
    });

    it('Rejects an empty password', async () => {
      expectValidationFailure(await login({ ...credentials, password: '' }));
    });

    it('Rejects a malformed email', async () => {
      expectValidationFailure(await login({ ...credentials, email: 'not-an-email' }));
    });

    it('Rejects an unrecognised field', async () => {
      expectValidationFailure(await login({ ...credentials, role: 'admin' }));
    });

    it('Accepts a password that registration would now be too strict to allow', async () => {
      const response = await login({ ...credentials, password: 'short' });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.INVALID_CREDENTIALS);
    });
  });

  describe('Rate limiting', () => {
    it('Answers 429 in the standard error shape once the limit is passed', async () => {
      const limited = await buildTestApp({
        databaseUrl: database.connectionString,
        rateLimitMax: 2,
      });

      try {
        expect((await login(credentials, limited)).statusCode).toBe(201);
        expect((await login(credentials, limited)).statusCode).toBe(201);

        const blocked = await login(credentials, limited);

        expect(blocked.statusCode).toBe(429);
        expect(blocked.json()).toEqual({
          code: errorCodes.RATE_LIMITED,
          message: expect.any(String),
        });
      } finally {
        await limited.close();
      }
    });

    it('Counts failures too, so guessing cannot outrun the limit', async () => {
      const limited = await buildTestApp({
        databaseUrl: database.connectionString,
        rateLimitMax: 2,
      });

      try {
        await login({ ...credentials, password: 'guess-one' }, limited);
        await login({ ...credentials, password: 'guess-two' }, limited);

        expect((await login(credentials, limited)).statusCode).toBe(429);
      } finally {
        await limited.close();
      }
    });

    it('Limits register and login independently', async () => {
      const limited = await buildTestApp({
        databaseUrl: database.connectionString,
        rateLimitMax: 1,
      });

      try {
        expect((await login(credentials, limited)).statusCode).toBe(201);
        expect((await login(credentials, limited)).statusCode).toBe(429);

        const registered = await limited.inject({
          method: 'POST',
          url: '/auth/register',
          payload: { ...account, email: 'own-bucket@example.com' },
        });

        expect(registered.statusCode).toBe(201);
      } finally {
        await limited.close();
      }
    });
  });

  describe('With an injected clock', () => {
    const signedAt = '2026-08-11T09:00:00Z';

    it('Stamps the token and the session expiry from the clock, not the wall clock', async () => {
      const clocked = await buildTestApp({
        databaseUrl: database.connectionString,
        now: () => new Date(signedAt),
      });

      try {
        const response = await login(credentials, clocked);
        const claims = verifyAccessToken(response.json().token, TEST_JWT_SECRET, {
          now: () => new Date(signedAt),
        });

        const issuedAt = Math.floor(Date.parse(signedAt) / 1000);
        expect(claims.iat).toBe(issuedAt);
        expect(claims.exp).toBe(issuedAt + TEST_JWT_TTL_SECONDS);

        const [row] = await database.db
          .select()
          .from(sessions)
          .where(eq(sessions.id, claims.session_id));

        expect(row?.expiresAt.toISOString()).toBe(
          new Date(Date.parse(signedAt) + TEST_REFRESH_TTL_SECONDS * 1000).toISOString(),
        );
      } finally {
        await clocked.close();
      }
    });

    it('Issues a token that is already expired when the TTL is negative', async () => {
      const expired = await buildTestApp({
        databaseUrl: database.connectionString,
        jwtTtlSeconds: -60,
      });

      try {
        const { token } = (await login(credentials, expired)).json();

        expect(() => verifyAccessToken(token, TEST_JWT_SECRET)).toThrow(jwt.TokenExpiredError);
      } finally {
        await expired.close();
      }
    });
  });
});
