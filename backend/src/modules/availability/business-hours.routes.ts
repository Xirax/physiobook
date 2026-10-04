import { errorResponseSchema, weeklyBusinessHoursSchema } from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getBusinessHours, replaceBusinessHours } from './business-hours.service.js';

export async function businessHoursRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const dependencies = { db: app.db };

  typed.get(
    '/business-hours',
    {
      onRequest: app.requireAuth,
      schema: {
        response: {
          200: weeklyBusinessHoursSchema,
          401: errorResponseSchema,
        },
      },
    },
    async () => getBusinessHours(dependencies),
  );

  typed.put(
    '/business-hours',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        body: weeklyBusinessHoursSchema,
        response: {
          200: weeklyBusinessHoursSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => replaceBusinessHours(request.body, dependencies),
  );
}
