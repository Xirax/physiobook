import { z } from 'zod';

import { appointmentSchema, appointmentStatusSchema } from './appointment.js';
import { publicUserSchema } from './auth.js';
import { calendarDateSchema, refineDateRange } from './date-range.js';

export const ADMIN_APPOINTMENTS_RANGE_MAX_DAYS = 92;

export const adminAppointmentsStatusFilterSchema = z.enum([
  ...appointmentStatusSchema.options,
  'any',
]);

/** Without from/to the list is the upcoming one: appointments starting after now. */
export const adminAppointmentsQuerySchema = refineDateRange(
  z
    .strictObject({
      from: calendarDateSchema.optional(),
      to: calendarDateSchema.optional(),
      status: adminAppointmentsStatusFilterSchema.default('active'),
    })
    .refine((query) => (query.from === undefined) === (query.to === undefined), {
      message: 'Give both ends of the range or neither',
      path: ['to'],
      when: (payload) => payload.issues.length === 0,
    }),
  ADMIN_APPOINTMENTS_RANGE_MAX_DAYS,
);

export const adminAppointmentSchema = appointmentSchema.extend({
  patient: publicUserSchema.pick({ id: true, email: true, full_name: true }),
});

export const adminAppointmentsResponseSchema = z.array(adminAppointmentSchema);
