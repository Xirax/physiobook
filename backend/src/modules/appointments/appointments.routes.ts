import {
  appointmentSchema,
  bookAppointmentRequestSchema,
  errorResponseSchema,
} from '@physiobook/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { authenticatedUser } from '../../plugins/auth.js';
import { rateLimitedPerUserRoute } from '../../plugins/rate-limit.js';

import { bookAppointment } from './appointments.service.js';

export interface AppointmentsRoutesOptions {
  bookingRateLimitMax: number;
  now?: () => Date;
}

export async function appointmentsRoutes(
  app: FastifyInstance,
  { bookingRateLimitMax, now = () => new Date() }: AppointmentsRoutesOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const dependencies = { db: app.db, now };

  typed.post(
    '/appointments',
    {
      onRequest: app.requireRole('user'),
      config: rateLimitedPerUserRoute(bookingRateLimitMax),
      schema: {
        body: bookAppointmentRequestSchema,
        response: {
          201: appointmentSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: userId } = authenticatedUser(request);
      const appointment = await bookAppointment(userId, request.body, dependencies);

      return reply.status(201).send(appointment);
    },
  );
}
