import {
  authResponseSchema,
  errorResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
} from '@physiobook/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { RATE_LIMITED_ROUTE } from '../../plugins/rate-limit.js';
import { loginUser, registerUser, type AuthResult } from './auth.service.js';

export interface AuthRoutesOptions {
  jwtSecret: string;
  jwtTtlSeconds: number;
  refreshTtlSeconds: number;
  now?: () => Date;
}

export async function authRoutes(
  app: FastifyInstance,
  { jwtSecret, jwtTtlSeconds, refreshTtlSeconds, now }: AuthRoutesOptions,
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
}
