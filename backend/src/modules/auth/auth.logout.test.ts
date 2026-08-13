import { randomUUID } from 'node:crypto';

import { sessions } from '@physiobook/db';
import { errorCodes } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { parseRefreshToken } from '../../lib/refresh-token.js';
import { authenticatedUser } from '../../plugins/auth.js';
import { REFRESH_COOKIE_NAME } from '../../plugins/cookie.js';

describe('POST /auth/logout', () => {
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

    app.get('/guarded', { onRequest: app.requireAuth }, (request) => authenticatedUser(request));

    await app.inject({ method: 'POST', url: '/auth/register', payload: account });
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  interface OpenedSession {
    accessToken: string;
    cookie: string;
    sessionId: string;
  }

  const login = async (): Promise<OpenedSession> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: account.email, password: account.password },
    });

    const cookie = response.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME)!.value;

    return {
      accessToken: response.json().token,
      cookie,
      sessionId: parseRefreshToken(cookie)!.sessionId,
    };
  };

  const logout = (accessToken?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: '/auth/logout',
      ...(accessToken === undefined ? {} : { headers: { authorization: `Bearer ${accessToken}` } }),
    });

  const guarded = (accessToken: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { authorization: `Bearer ${accessToken}` },
    });

  const refresh = (cookie: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { [REFRESH_COOKIE_NAME]: cookie },
    });

  const revokedAtOf = async (sessionId: string): Promise<Date | null | undefined> => {
    const [row] = await database.db.select().from(sessions).where(eq(sessions.id, sessionId));

    return row?.revokedAt;
  };

  describe('An authenticated caller', () => {
    it('Answers 204 with an empty body', async () => {
      const opened = await login();

      const response = await logout(opened.accessToken);

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
    });

    it('Revokes the session the token names', async () => {
      const opened = await login();

      await logout(opened.accessToken);

      expect(await revokedAtOf(opened.sessionId)).toBeInstanceOf(Date);
    });

    it('Clears the refresh cookie', async () => {
      const opened = await login();

      const cleared = (await logout(opened.accessToken)).cookies.find(
        (entry) => entry.name === REFRESH_COOKIE_NAME,
      );

      expect(cleared).toBeDefined();
      expect(cleared?.value).toBe('');
    });

    it('Accepts the JSON content type an api-client sets on every POST, with no body', async () => {
      const opened = await login();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          authorization: `Bearer ${opened.accessToken}`,
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(await revokedAtOf(opened.sessionId)).toBeInstanceOf(Date);
    });

    it('Ignores a body someone sends anyway', async () => {
      const opened = await login();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { authorization: `Bearer ${opened.accessToken}` },
        payload: { unexpected: 'field' },
      });

      expect(response.statusCode).toBe(204);
    });

    it('Still answers 400 to a body that is not the JSON it claims to be', async () => {
      const opened = await login();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          authorization: `Bearer ${opened.accessToken}`,
          'content-type': 'application/json',
        },
        payload: '{ not json',
      });

      expect(response.statusCode).toBe(400);
      expect(await revokedAtOf(opened.sessionId)).toBeNull();
    });

    it("Leaves the account's other sessions alone", async () => {
      const first = await login();
      const second = await login();

      await logout(first.accessToken);

      expect(await revokedAtOf(second.sessionId)).toBeNull();
      expect((await guarded(second.accessToken)).statusCode).toBe(200);
    });
  });

  describe('Once logged out', () => {
    it('Rejects a still-unexpired access token on a guarded route', async () => {
      const opened = await login();

      expect((await guarded(opened.accessToken)).statusCode).toBe(200);

      await logout(opened.accessToken);

      const response = await guarded(opened.accessToken);

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
    });

    it('Rejects the refresh cookie it was holding', async () => {
      const opened = await login();

      await logout(opened.accessToken);

      expect((await refresh(opened.cookie)).statusCode).toBe(401);
    });

    it('Rejects a second logout with the same token', async () => {
      const opened = await login();

      await logout(opened.accessToken);

      expect((await logout(opened.accessToken)).statusCode).toBe(401);
    });

    it('Keeps the stamp of the first logout', async () => {
      const opened = await login();

      await logout(opened.accessToken);
      const first = await revokedAtOf(opened.sessionId);
      await logout(opened.accessToken);

      expect(await revokedAtOf(opened.sessionId)).toEqual(first);
    });
  });

  describe('Refuses with 401', () => {
    const expectChallenge = (response: LightMyRequestResponse) => {
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    };

    it('When no token is presented', async () => {
      expectChallenge(await logout());
    });

    it('When the token is not signed by this server', async () => {
      expectChallenge(await logout('not.a.token'));
    });

    it('When only the refresh cookie is presented', async () => {
      const opened = await login();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        cookies: { [REFRESH_COOKIE_NAME]: opened.cookie },
      });

      expectChallenge(response);
      expect(await revokedAtOf(opened.sessionId)).toBeNull();
    });

    it('Revokes nothing when it refuses', async () => {
      const opened = await login();

      await logout(`Bearer ${randomUUID()}`);

      expect(await revokedAtOf(opened.sessionId)).toBeNull();
    });
  });
});
