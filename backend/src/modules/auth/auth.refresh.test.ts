import { randomUUID } from 'node:crypto';

import { sessions } from '@physiobook/db';
import { errorCodes } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  TEST_JWT_SECRET,
  TEST_JWT_TTL_SECONDS,
} from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { parseRefreshToken } from '../../lib/refresh-token.js';
import { verifyAccessToken } from '../../lib/tokens.js';
import { REFRESH_COOKIE_NAME } from '../../plugins/cookie.js';

describe('POST /auth/refresh', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString });
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  interface OpenedSession {
    accessToken: string;
    cookie: string;
    userId: string;
    sessionId: string;
  }

  const openSession = async (instance: FastifyInstance = app): Promise<OpenedSession> => {
    const response = await instance.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: `${randomUUID()}@example.com`,
        password: 'correct-horse-battery',
        full_name: 'Ada Lovelace',
      },
    });

    const cookie = response.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME)!.value;
    const body = response.json();

    return {
      accessToken: body.token,
      cookie,
      userId: body.user.id,
      sessionId: parseRefreshToken(cookie)!.sessionId,
    };
  };

  const refresh = (
    cookie: string | undefined,
    instance: FastifyInstance = app,
  ): Promise<LightMyRequestResponse> =>
    instance.inject({
      method: 'POST',
      url: '/auth/refresh',
      ...(cookie === undefined ? {} : { cookies: { [REFRESH_COOKIE_NAME]: cookie } }),
    });

  const logout = (accessToken: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
    });

  describe('A live session', () => {
    it('Answers 200 with a token and nothing else', async () => {
      const opened = await openSession();

      const response = await refresh(opened.cookie);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ token: expect.any(String) });
    });

    it('Mints a token for the same session and the same user', async () => {
      const opened = await openSession();

      const claims = verifyAccessToken(
        (await refresh(opened.cookie)).json().token,
        TEST_JWT_SECRET,
      );

      expect(claims.session_id).toBe(opened.sessionId);
      expect(claims.sub).toBe(opened.userId);
      expect(claims.role).toBe('user');
    });

    it('Gives the new token a full lifetime of its own', async () => {
      const opened = await openSession();

      const claims = verifyAccessToken(
        (await refresh(opened.cookie)).json().token,
        TEST_JWT_SECRET,
      );

      expect(claims.exp - claims.iat).toBe(TEST_JWT_TTL_SECONDS);
    });

    it('Sets no cookie, since the refresh token is not rotated', async () => {
      const opened = await openSession();

      expect((await refresh(opened.cookie)).cookies).toHaveLength(0);
    });

    it('Never echoes the cookie secret back to the caller', async () => {
      const opened = await openSession();
      const { secret } = parseRefreshToken(opened.cookie)!;

      expect((await refresh(opened.cookie)).body).not.toContain(secret);
    });

    it('Keeps working when called repeatedly', async () => {
      const opened = await openSession();

      const responses = await Promise.all([
        refresh(opened.cookie),
        refresh(opened.cookie),
        refresh(opened.cookie),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    });

    it('Accepts the JSON content type an api-client sets on every POST, with no body', async () => {
      const opened = await openSession();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { 'content-type': 'application/json' },
        cookies: { [REFRESH_COOKIE_NAME]: opened.cookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ token: expect.any(String) });
    });

    it('Ignores a body someone sends anyway', async () => {
      const opened = await openSession();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { unexpected: 'field' },
        cookies: { [REFRESH_COOKIE_NAME]: opened.cookie },
      });

      expect(response.statusCode).toBe(200);
    });

    it('Still answers 400 to a body that is not the JSON it claims to be', async () => {
      const opened = await openSession();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { 'content-type': 'application/json' },
        payload: '{ not json',
        cookies: { [REFRESH_COOKIE_NAME]: opened.cookie },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Rate limiting', () => {
    it("Does not share login's bucket, so several tabs loading cannot exhaust it", async () => {
      const limited = await buildTestApp({
        databaseUrl: database.connectionString,
        rateLimitMax: 2,
      });

      try {
        const opened = await openSession(limited);

        for (let attempt = 0; attempt < 5; attempt += 1) {
          expect((await refresh(opened.cookie, limited)).statusCode).toBe(200);
        }
      } finally {
        await limited.close();
      }
    });

    it('Answers 429 in the standard error shape once its own bucket is passed', async () => {
      const limited = await buildTestApp({
        databaseUrl: database.connectionString,
        refreshRateLimitMax: 2,
      });

      try {
        const opened = await openSession(limited);

        expect((await refresh(opened.cookie, limited)).statusCode).toBe(200);
        expect((await refresh(opened.cookie, limited)).statusCode).toBe(200);

        const blocked = await refresh(opened.cookie, limited);

        expect(blocked.statusCode).toBe(429);
        expect(blocked.json()).toEqual({
          code: errorCodes.RATE_LIMITED,
          message: expect.any(String),
        });
      } finally {
        await limited.close();
      }
    });

    it('Counts refusals too, so a forged cookie cannot be retried without bound', async () => {
      const limited = await buildTestApp({
        databaseUrl: database.connectionString,
        refreshRateLimitMax: 2,
      });

      try {
        expect((await refresh(`${randomUUID()}.one`, limited)).statusCode).toBe(401);
        expect((await refresh(`${randomUUID()}.two`, limited)).statusCode).toBe(401);

        expect((await refresh(`${randomUUID()}.three`, limited)).statusCode).toBe(429);
      } finally {
        await limited.close();
      }
    });

    it('Leaves login reachable once refresh has been exhausted', async () => {
      const limited = await buildTestApp({
        databaseUrl: database.connectionString,
        refreshRateLimitMax: 1,
      });

      try {
        const opened = await openSession(limited);

        expect((await refresh(opened.cookie, limited)).statusCode).toBe(200);
        expect((await refresh(opened.cookie, limited)).statusCode).toBe(429);

        const login = await limited.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'admin@physiobook.local', password: 'ChangeMe123!' },
        });

        expect(login.statusCode).toBe(201);
      } finally {
        await limited.close();
      }
    });
  });

  describe('Refuses with 401', () => {
    const expectUnauthorized = (response: LightMyRequestResponse) => {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        code: errorCodes.UNAUTHORIZED,
        message: expect.any(String),
      });
      expect(response.headers['www-authenticate']).toBe('Bearer');
    };

    it('When no cookie is sent at all', async () => {
      expectUnauthorized(await refresh(undefined));
    });

    it('When the cookie carries no separator', async () => {
      expectUnauthorized(await refresh('not-a-refresh-token'));
    });

    it('When the session id is not a uuid, rather than letting it become a 500', async () => {
      expectUnauthorized(await refresh('not-a-uuid.some-secret'));
    });

    it('When no session by that id exists', async () => {
      expectUnauthorized(await refresh(`${randomUUID()}.some-secret`));
    });

    it('When the session is real but the secret is wrong', async () => {
      const opened = await openSession();

      expectUnauthorized(await refresh(`${opened.sessionId}.not-the-secret`));
    });

    it('When the session has been revoked by a logout', async () => {
      const opened = await openSession();
      await logout(opened.accessToken);

      expectUnauthorized(await refresh(opened.cookie));
    });

    it('When the session has expired', async () => {
      const opened = await openSession();

      await database.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, opened.sessionId));

      expectUnauthorized(await refresh(opened.cookie));
    });

    it('Answers a revoked session and a forged one identically', async () => {
      const opened = await openSession();
      await logout(opened.accessToken);

      const [revoked, forged] = await Promise.all([
        refresh(opened.cookie),
        refresh(`${randomUUID()}.some-secret`),
      ]);

      expect(revoked.statusCode).toBe(forged.statusCode);
      expect(revoked.body).toBe(forged.body);
    });

    it('Clears the dead cookie, so the browser stops resending it', async () => {
      const opened = await openSession();
      await logout(opened.accessToken);

      const cleared = (await refresh(opened.cookie)).cookies.find(
        (entry) => entry.name === REFRESH_COOKIE_NAME,
      );

      expect(cleared).toBeDefined();
      expect(cleared?.value).toBe('');
    });
  });
});
