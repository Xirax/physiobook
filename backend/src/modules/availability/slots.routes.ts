import { errorResponseSchema, slotsQuerySchema, slotsResponseSchema } from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getBookableSlots } from './slots.service.js';

export interface SlotsRoutesOptions {
  now?: () => Date;
}

export async function slotsRoutes(
  app: FastifyInstance,
  { now = () => new Date() }: SlotsRoutesOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const dependencies = { db: app.db, now };

  typed.get(
    '/slots',
    {
      onRequest: app.requireAuth,
      schema: {
        querystring: slotsQuerySchema,
        response: {
          200: slotsResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => getBookableSlots(request.query, dependencies),
  );
}
