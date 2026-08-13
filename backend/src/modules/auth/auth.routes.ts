import {
  authResponseSchema,
  errorResponseSchema,
  loginRequestSchema,
  refreshResponseSchema,
  registerRequestSchema,
} from '@physiobook/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { UnauthorizedError } from '../../lib/errors.js';
import { authenticatedUser } from '../../plugins/auth.js';
import { REFRESH_COOKIE_NAME } from '../../plugins/cookie.js';
import { RATE_LIMITED_ROUTE, rateLimitedRoute } from '../../plugins/rate-limit.js';
import {
  loginUser,
  refreshSession,
  registerUser,
  revokeSession,
  type AuthResult,
} from './auth.service.js';

export interface AuthRoutesOptions {
  jwtSecret: string;
  jwtTtlSeconds: number;
  refreshTtlSeconds: number;
  refreshRateLimitMax: number;
  now?: () => Date;
}

export async function authRoutes(
  app: FastifyInstance,
  { jwtSecret, jwtTtlSeconds, refreshTtlSeconds, refreshRateLimitMax, now }: AuthRoutesOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const dependencies = {
    db: app.db,
    jwtSecret,
    jwtTtlSeconds,
    refreshTtlSeconds,
    ...(now === undefined ? {} : { now }),
  };

  const respond = (reply: FastifyReply, result: AuthResult) => {
    app.setRefreshCookie(reply, result.refreshToken, result.refreshTtlSeconds);

    return reply.status(201).send({ user: result.user, token: result.token });
  };

  typed.post(
    '/auth/register',
    {
      config: RATE_LIMITED_ROUTE,
      schema: {
        body: registerRequestSchema,
        response: {
          201: authResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => respond(reply, await registerUser(request.body, dependencies)),
  );

  typed.post(
    '/auth/login',
    {
      config: RATE_LIMITED_ROUTE,
      schema: {
        body: loginRequestSchema,
        response: {
          201: authResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => respond(reply, await loginUser(request.body, dependencies)),
  );

  await app.register(async (bodyless) => {
    const parseJson = bodyless.getDefaultJsonParser('error', 'error');

    bodyless.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (request, body: string, done) => {
        if (body === '') {
          done(null, undefined);

          return;
        }

        parseJson(request, body, done);
      },
    );

    const typedBodyless = bodyless.withTypeProvider<ZodTypeProvider>();

    typedBodyless.post(
      '/auth/refresh',
      {
        config: rateLimitedRoute(refreshRateLimitMax),
        schema: {
          response: {
            200: refreshResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            429: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          return await refreshSession(request.cookies[REFRESH_COOKIE_NAME], dependencies);
        } catch (error) {
          if (error instanceof UnauthorizedError) bodyless.clearRefreshCookie(reply);

          throw error;
        }
      },
    );

    typedBodyless.post(
      '/auth/logout',
      {
        onRequest: bodyless.requireAuth,
        schema: {
          response: {
            204: z.void(),
            400: errorResponseSchema,
            401: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        await revokeSession(authenticatedUser(request).sessionId, dependencies);
        bodyless.clearRefreshCookie(reply);

        return reply.status(204).send();
      },
    );
  });
}
