import { z } from 'zod';

import { appointmentSchema, appointmentStatusSchema } from './appointment.js';
import { publicUserSchema } from './auth.js';
import { inclusiveDays } from './date-range.js';

export const ADMIN_APPOINTMENTS_RANGE_MAX_DAYS = 92;

export const adminAppointmentsStatusFilterSchema = z.enum([
  ...appointmentStatusSchema.options,
  'any',
]);

/** Without from/to the list is the upcoming one: appointments starting after now. */
export const adminAppointmentsQuerySchema = z
  .strictObject({
    from: z.iso.date({ message: 'Enter a date as YYYY-MM-DD' }).optional(),
    to: z.iso.date({ message: 'Enter a date as YYYY-MM-DD' }).optional(),
    status: adminAppointmentsStatusFilterSchema.default('active'),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Give both ends of the range or neither',
    path: ['to'],
    when: (payload) => payload.issues.length === 0,
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.to >= query.from, {
    message: 'The range must end on or after its first day',
    path: ['to'],
    when: (payload) => payload.issues.length === 0,
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      inclusiveDays(query.from, query.to) <= ADMIN_APPOINTMENTS_RANGE_MAX_DAYS,
    {
      message: `The range can span at most ${ADMIN_APPOINTMENTS_RANGE_MAX_DAYS} days`,
      path: ['to'],
      when: (payload) => payload.issues.length === 0,
    },
  );

export const adminAppointmentSchema = appointmentSchema.extend({
  patient: publicUserSchema.pick({ id: true, email: true, full_name: true }),
});

export const adminAppointmentsResponseSchema = z.array(adminAppointmentSchema);
