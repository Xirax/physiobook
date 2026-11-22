import type { z } from 'zod';

import type {
  adminAppointmentSchema,
  adminAppointmentsQuerySchema,
  adminAppointmentsResponseSchema,
  adminAppointmentsStatusFilterSchema,
} from '../schemas/admin-appointments.js';

export type AdminAppointmentsStatusFilter = z.infer<typeof adminAppointmentsStatusFilterSchema>;
export type AdminAppointmentsQuery = z.infer<typeof adminAppointmentsQuerySchema>;
export type AdminAppointment = z.infer<typeof adminAppointmentSchema>;
export type AdminAppointmentsResponse = z.infer<typeof adminAppointmentsResponseSchema>;
