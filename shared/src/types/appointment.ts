import type { z } from 'zod';

import type {
  appointmentParamsSchema,
  appointmentSchema,
  appointmentStatusSchema,
  bookAppointmentRequestSchema,
} from '../schemas/appointment.js';

export type BookAppointmentRequest = z.infer<typeof bookAppointmentRequestSchema>;
export type AppointmentParams = z.infer<typeof appointmentParamsSchema>;
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
