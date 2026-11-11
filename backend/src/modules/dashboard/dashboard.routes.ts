import {
  errorResponseSchema,
  workloadQuerySchema,
  workloadResponseSchema,
} from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { authenticatedUser } from '../../plugins/auth.js';

import { getWorkload } from './dashboard.service.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const dependencies = { db: app.db };

  typed.get(
    '/admin/workload',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        querystring: workloadQuerySchema,
        response: {
          200: workloadResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: practitionerId } = authenticatedUser(request);
      return getWorkload(practitionerId, request.query, dependencies);
    },
  );
}
