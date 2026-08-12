import { randomUUID } from 'node:crypto';

import { sessions, users } from '@physiobook/db';
import { errorCodes, errorResponseSchema, roleSchema } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  buildTestApp,
  TEST_JWT_SECRET,
  TEST_JWT_TTL_SECONDS,
  type TestAppOptions,
} from '../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../tests/helpers/test-db.js';
import { signAccessToken, verifyAccessToken } from '../lib/tokens.js';
import { authenticatedUser } from './auth.js';

const identitySchema = z.strictObject({
  id: z.uuid(),
  role: roleSchema,
  sessionId: z.uuid(),
});

export const GUARDED_BODY_FIELD = 'secretFieldName';

function attachGuardedRoutes(app: FastifyInstance): void {
  const whoami = (request: FastifyRequest) => authenticatedUser(request);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/guarded/any',
    {
      onRequest: app.requireAuth,
      schema: { response: { 200: identitySchema, 401: errorResponseSchema } },
    },
    whoami,
  );

  typed.post(
    '/guarded/with-body',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        body: z.strictObject({ [GUARDED_BODY_FIELD]: z.string() }),
        response: { 200: identitySchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    whoami,
  );

  app.get('/guarded/user-only', { onRequest: app.requireRole('user') }, whoami);
  app.get('/guarded/admin-only', { onRequest: app.requireRole('admin') }, whoami);
  app.get('/guarded/either', { onRequest: app.requireRole('user', 'admin') }, whoami);
  app.get('/guarded/composed', { onRequest: [app.requireAuth, app.requireRole('admin')] }, whoami);

  app.get('/open', (request) => ({ user: request.user }));
  app.get('/forgotten-guard', whoami);
}

describe('Auth plugin', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let userToken: string;
  let adminToken: string;

  const account = {
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    full_name: 'Ada Lovelace',
  };

  const adminCredentials = { email: 'admin@physiobook.local', password: 'ChangeMe123!' };
  const userCredentials = { email: account.email, password: account.password };

  const buildGuardedApp = async (
    options: Omit<TestAppOptions, 'databaseUrl'> = {},
  ): Promise<FastifyInstance> => {
    const instance = await buildTestApp({ databaseUrl: database.connectionString, ...options });

    attachGuardedRoutes(instance);

    return instance;
  };

  const login = async (
    payload: { email: string; password: string },
    instance: FastifyInstance = app,
  ): Promise<string> => {
    const response = await instance.inject({ method: 'POST', url: '/auth/login', payload });

    return response.json().token as string;
  };

  const get = (
    url: string,
    token?: string,
    instance: FastifyInstance = app,
  ): Promise<LightMyRequestResponse> =>
    instance.inject({
      method: 'GET',
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  const idOf = async (email: string): Promise<string> => {
    const [row] = await database.db.select().from(users).where(eq(users.email, email));

    return row!.id;
  };

  const sessionIdOf = (token: string): string =>
    verifyAccessToken(token, TEST_JWT_SECRET).session_id;

  const expectUnauthorized = (response: LightMyRequestResponse): void => {
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: errorCodes.UNAUTHORIZED,
      message: 'Authentication required',
    });
  };

  const expectForbidden = (response: LightMyRequestResponse): void => {
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: errorCodes.FORBIDDEN,
      message: expect.any(String),
    });
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildGuardedApp();

    await app.inject({ method: 'POST', url: '/auth/register', payload: account });

    userToken = await login(userCredentials);
    adminToken = await login(adminCredentials);
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  describe('requireAuth', () => {
    it('Runs the handler with request.user populated', async () => {
      const response = await get('/guarded/any', userToken);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: await idOf(account.email),
        role: 'user',
        sessionId: sessionIdOf(userToken),
      });
    });

    it('Admits an admin as readily as a user', async () => {
      const response = await get('/guarded/any', adminToken);

      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe('admin');
    });

    it('Fails closed when a handler asks for a user no guard established', async () => {
      expectUnauthorized(await get('/forgotten-guard', userToken));
    });

    it('Leaves request.user null on a route no guard protects', async () => {
      const response = await get('/open', userToken);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user: null });
    });
  });

  describe('Rejected tokens', () => {
    it('Answers 401 when no token is presented at all', async () => {
      expectUnauthorized(await get('/guarded/any'));
    });

    it('Answers 401 for a scheme that is not Bearer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/guarded/any',
        headers: { authorization: `Basic ${userToken}` },
      });

      expectUnauthorized(response);
    });

    it('Answers 401 for a bare token with no scheme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/guarded/any',
        headers: { authorization: userToken },
      });

      expectUnauthorized(response);
    });

    it('Answers 401 for an empty Bearer value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/guarded/any',
        headers: { authorization: 'Bearer ' },
      });

      expectUnauthorized(response);
    });

    it('Answers 401 for a tampered signature', async () => {
      const [header, payload, signature] = userToken.split('.');
      const flipped = signature!.startsWith('A')
        ? `B${signature!.slice(1)}`
        : `A${signature!.slice(1)}`;

      expectUnauthorized(await get('/guarded/any', `${header!}.${payload!}.${flipped}`));
    });

    it('Answers 401 for a payload edited after signing', async () => {
      const [header, , signature] = userToken.split('.');
      const forged = Buffer.from(
        JSON.stringify({
          sub: await idOf(account.email),
          role: 'admin',
          session_id: sessionIdOf(userToken),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + TEST_JWT_TTL_SECONDS,
        }),
      ).toString('base64url');

      expectUnauthorized(await get('/guarded/any', `${header!}.${forged}.${signature!}`));
    });

    it('Answers 401 for a token signed with another secret', async () => {
      const token = signAccessToken(
        { id: await idOf(account.email), role: 'user', sessionId: sessionIdOf(userToken) },
        { secret: 'a-different-secret-that-is-long-enough', ttlSeconds: TEST_JWT_TTL_SECONDS },
      );

      expectUnauthorized(await get('/guarded/any', token));
    });

    it('Answers 401 for an expired token', async () => {
      const expiredIssuer = await buildGuardedApp({ jwtTtlSeconds: -60 });

      try {
        expectUnauthorized(await get('/guarded/any', await login(userCredentials, expiredIssuer)));
      } finally {
        await expiredIssuer.close();
      }
    });

    it('Measures expiry against the injected clock, not the wall clock', async () => {
      const future = await buildGuardedApp({
        now: () => new Date(Date.now() + (TEST_JWT_TTL_SECONDS + 60) * 1000),
      });

      try {
        expect((await get('/guarded/any', userToken)).statusCode).toBe(200);
        expectUnauthorized(await get('/guarded/any', userToken, future));
      } finally {
        await future.close();
      }
    });
  });

  describe('The session behind the token', () => {
    const tokenWithSession = async (sessionId: string, email = account.email): Promise<string> =>
      signAccessToken(
        { id: await idOf(email), role: 'user', sessionId },
        { secret: TEST_JWT_SECRET, ttlSeconds: TEST_JWT_TTL_SECONDS },
      );

    it('Answers 401 when the session no longer exists', async () => {
      expectUnauthorized(await get('/guarded/any', await tokenWithSession(randomUUID())));
    });

    it('Answers 401 rather than 500 when the session claim is not even a uuid', async () => {
      expectUnauthorized(await get('/guarded/any', await tokenWithSession('not-a-uuid')));
    });

    it('Answers 401 when the session belongs to a different user', async () => {
      const token = await tokenWithSession(sessionIdOf(adminToken));

      expectUnauthorized(await get('/guarded/any', token));
    });

    it('Stops accepting a token the instant its session is revoked', async () => {
      const token = await login(userCredentials);

      expect((await get('/guarded/any', token)).statusCode).toBe(200);

      await database.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, sessionIdOf(token)));

      expectUnauthorized(await get('/guarded/any', token));
    });

    it('Answers 401 once the session has expired, even while the token has not', async () => {
      const token = await login(userCredentials);

      await database.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, sessionIdOf(token)));

      expectUnauthorized(await get('/guarded/any', token));
    });
  });

  describe('requireRole', () => {
    it('Admits the role the route names', async () => {
      const response = await get('/guarded/user-only', userToken);

      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe('user');
    });

    it('Admits an admin on an admin-only route', async () => {
      expect((await get('/guarded/admin-only', adminToken)).statusCode).toBe(200);
    });

    it('Rejects an admin on a user-only route: the roles are a set, not a ladder', async () => {
      expectForbidden(await get('/guarded/user-only', adminToken));
    });

    it('Rejects a user on an admin-only route', async () => {
      expectForbidden(await get('/guarded/admin-only', userToken));
    });

    it('Admits both roles when the route names both', async () => {
      expect((await get('/guarded/either', userToken)).statusCode).toBe(200);
      expect((await get('/guarded/either', adminToken)).statusCode).toBe(200);
    });

    it('Authenticates before it authorises, so a missing token is 401 not 403', async () => {
      expectUnauthorized(await get('/guarded/admin-only'));
    });

    it('Answers 401 for a revoked session even where the role would have been allowed', async () => {
      const token = await login(adminCredentials);

      await database.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, sessionIdOf(token)));

      expectUnauthorized(await get('/guarded/admin-only', token));
    });

    it('Composes with requireAuth on one route', async () => {
      expect((await get('/guarded/composed', adminToken)).statusCode).toBe(200);
      expectForbidden(await get('/guarded/composed', userToken));
    });

    it('Reads the session once when both guards are listed', async () => {
      const selects = vi.spyOn(app.db, 'select');

      try {
        expect((await get('/guarded/composed', adminToken)).statusCode).toBe(200);
        expect(selects).toHaveBeenCalledTimes(1);
      } finally {
        selects.mockRestore();
      }
    });
  });

  describe('Ordering against the rest of the lifecycle', () => {
    const postWithBody = (
      payload: Record<string, unknown>,
      token?: string,
    ): Promise<LightMyRequestResponse> =>
      app.inject({
        method: 'POST',
        url: '/guarded/with-body',
        payload,
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      });

    it('Answers an anonymous caller 401 even when the body is malformed', async () => {
      expectUnauthorized(await postWithBody({ wrong: 'shape' }));
    });

    it('Tells an anonymous caller nothing about the schema it failed', async () => {
      const response = await postWithBody({ wrong: 'shape' });

      expect(response.body).not.toContain(GUARDED_BODY_FIELD);
      expect(response.body).not.toContain('wrong');
    });

    it('Rejects an authenticated caller on role before it parses the body', async () => {
      expectForbidden(await postWithBody({ wrong: 'shape' }, userToken));
    });

    it('Still validates the body once the caller is authorised', async () => {
      const response = await postWithBody({ wrong: 'shape' }, adminToken);

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
    });

    it('Runs the handler for an authorised caller with a valid body', async () => {
      const response = await postWithBody({ [GUARDED_BODY_FIELD]: 'value' }, adminToken);

      expect(response.statusCode).toBe(200);
      expect(response.json().role).toBe('admin');
    });
  });

  describe('The error envelope', () => {
    it('Answers every 401 cause with one indistinguishable body', async () => {
      const revoked = await login(userCredentials);
      await database.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, sessionIdOf(revoked)));

      const [missing, tampered, killed] = await Promise.all([
        get('/guarded/any'),
        get('/guarded/any', `${userToken}tampered`),
        get('/guarded/any', revoked),
      ]);

      expect(missing.body).toBe(tampered.body);
      expect(missing.body).toBe(killed.body);
    });

    it('Names the scheme on a 401, identically for every cause', async () => {
      const [missing, tampered] = await Promise.all([
        get('/guarded/any'),
        get('/guarded/any', `${userToken}tampered`),
      ]);

      expect(missing.headers['www-authenticate']).toBe('Bearer');
      expect(tampered.headers['www-authenticate']).toBe(missing.headers['www-authenticate']);
    });

    it('Leaves the scheme unnamed on a 403, which is not a challenge', async () => {
      const response = await get('/guarded/admin-only', userToken);

      expect(response.headers['www-authenticate']).toBeUndefined();
    });

    it('Never echoes the presented token back', async () => {
      const response = await get('/guarded/any', `${userToken}tampered`);

      expect(response.body).not.toContain(userToken);
    });
  });
});
