import {
  createTimeOffRequestSchema,
  errorResponseSchema,
  timeOffConflictResponseSchema,
  timeOffParamsSchema,
  timeOffSchema,
} from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticatedUser } from '../../plugins/auth.js';

import { cancelTimeOff, createTimeOff } from './time-off.service.js';

export interface TimeOffRoutesOptions {
  now?: () => Date;
}

export async function timeOffRoutes(
  app: FastifyInstance,
  { now = () => new Date() }: TimeOffRoutesOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const dependencies = { db: app.db, now };

  typed.post(
    '/time-off',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        body: createTimeOffRequestSchema,
        response: {
          201: timeOffSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: timeOffConflictResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: practitionerId } = authenticatedUser(request);
      const timeOff = await createTimeOff(practitionerId, request.body, dependencies);

      return reply.status(201).send(timeOff);
    },
  );

  typed.delete(
    '/time-off/:id',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        params: timeOffParamsSchema,
        response: {
          204: z.void(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: practitionerId } = authenticatedUser(request);
      await cancelTimeOff(practitionerId, request.params.id, dependencies);

      return reply.status(204).send();
    },
  );
}
