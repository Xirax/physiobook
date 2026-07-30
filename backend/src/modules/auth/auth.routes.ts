import { authResponseSchema, errorResponseSchema, registerRequestSchema } from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { registerUser } from './auth.service.js';

export interface AuthRoutesOptions {
  jwtSecret: string;
  jwtTtlSeconds: number;
  now?: () => Date;
}

export async function authRoutes(
  app: FastifyInstance,
  { jwtSecret, jwtTtlSeconds, now }: AuthRoutesOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/auth/register',
    {
      schema: {
        body: registerRequestSchema,
        response: {
          201: authResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await registerUser(request.body, {
        db: app.db,
        jwtSecret,
        jwtTtlSeconds,
        ...(now === undefined ? {} : { now }),
      });

      return reply.status(201).send(result);
    },
  );
}
