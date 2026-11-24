import { defineTemplate } from '../lib/mail-template.js';

import { longDate, time, timeRange, type TimeSpan } from './mail-format.js';

export interface CancellationMailData {
  timezone: string;
  appointment: TimeSpan & { patientName: string };
}

export const cancellationMail = defineTemplate(
  ({ timezone, appointment }: CancellationMailData) => {
    const date = longDate(appointment.start, timezone);

    return {
      subject: `Cancelled: your appointment on ${date} at ${time(appointment.start, timezone)}`,
      paragraphs: [
        `Hi ${appointment.patientName},`,
        `We are sorry to let you know that the clinic has cancelled your physiotherapy ` +
          `appointment on ${date}, ${timeRange(appointment, timezone)} (${timezone} time).`,
        'You are welcome to book another time that suits you.',
      ],
    };
  },
);
