import { errorCodes, publicUserSchema, type PublicUser } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { REFRESH_COOKIE_NAME } from '../../plugins/cookie.js';

describe('GET /auth/me', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  const account = {
    email: 'grace@example.com',
    password: 'correct-horse-battery',
    full_name: 'Grace Hopper',
  };

  const adminCredentials = { email: 'admin@physiobook.local', password: 'ChangeMe123!' };

  let registered: { user: PublicUser; token: string };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString });

    registered = (
      await app.inject({ method: 'POST', url: '/auth/register', payload: account })
    ).json();
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  const me = (accessToken?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'GET',
      url: '/auth/me',
      ...(accessToken === undefined ? {} : { headers: { authorization: `Bearer ${accessToken}` } }),
    });

  const login = (credentials: {
    email: string;
    password: string;
  }): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url: '/auth/login', payload: credentials });

  const tokenFrom = async (credentials: { email: string; password: string }): Promise<string> =>
    (await login(credentials)).json().token;

  describe('An authenticated caller', () => {
    it('Answers 200 with the identity the token names', async () => {
      const response = await me(registered.token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(registered.user);
    });

    it('Answers the shape the contract owns, and nothing beside it', async () => {
      const body: unknown = (await me(registered.token)).json();

      expect(publicUserSchema.safeParse(body).success).toBe(true);
      expect(Object.keys(body as object).sort()).toEqual([
        'created_at',
        'email',
        'full_name',
        'id',
        'role',
      ]);
    });

    it("Reports the seeded admin's role", async () => {
      const response = await me(await tokenFrom(adminCredentials));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ email: adminCredentials.email, role: 'admin' });
    });
  });

  describe('Refuses with 401', () => {
    const expectChallenge = (response: LightMyRequestResponse) => {
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    };

    it('When no credential is presented', async () => {
      expectChallenge(await me());
    });

    it('When the token is not signed by this server', async () => {
      expectChallenge(await me('not.a.token'));
    });

    it('When only the refresh cookie is presented', async () => {
      const opened = await login({ email: account.email, password: account.password });
      const cookie = opened.cookies.find((entry) => entry.name === REFRESH_COOKIE_NAME)!.value;

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        cookies: { [REFRESH_COOKIE_NAME]: cookie },
      });

      expectChallenge(response);
    });

    it('Once the session behind the token has been logged out', async () => {
      const token = await tokenFrom({ email: account.email, password: account.password });

      expect((await me(token)).statusCode).toBe(200);

      await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });

      expectChallenge(await me(token));
    });
  });
});
