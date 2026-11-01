import { z } from 'zod';

export const bookAppointmentRequestSchema = z.strictObject({
  start: z.iso.datetime({ message: 'Enter a UTC timestamp, e.g. 2026-11-02T09:00:00Z' }),
});

export const appointmentStatusSchema = z.enum(['active', 'cancelled', 'cancelled_by_admin']);

export const appointmentSchema = z.strictObject({
  id: z.uuid(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  status: appointmentStatusSchema,
});
