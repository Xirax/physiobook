import { DateTime } from 'luxon';

import { defineTemplate } from '../lib/mail-template.js';

export interface ReminderAppointment {
  start: Date;
  end: Date;
  patientName: string;
}

export interface UserReminderData {
  timezone: string;
  appointment: ReminderAppointment;
}

export interface AdminRunReminderData {
  timezone: string;
  /** The run's active appointments, earliest first; never empty. */
  appointments: [ReminderAppointment, ...ReminderAppointment[]];
}

function local(instant: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: timezone }).setLocale('en-GB');
}

const longDate = (instant: Date, timezone: string) =>
  local(instant, timezone).toFormat('cccc d LLLL yyyy');

const time = (instant: Date, timezone: string) => local(instant, timezone).toFormat('HH:mm');

const timeRange = ({ start, end }: ReminderAppointment, timezone: string) =>
  `${time(start, timezone)}–${time(end, timezone)}`;

export const userReminderMail = defineTemplate(({ timezone, appointment }: UserReminderData) => {
  const date = longDate(appointment.start, timezone);

  return {
    subject: `Reminder: your appointment on ${date} at ${time(appointment.start, timezone)}`,
    paragraphs: [
      `Hi ${appointment.patientName},`,
      `This is a reminder of your physiotherapy appointment on ${date}, ` +
        `${timeRange(appointment, timezone)} (${timezone} time).`,
      'If you can no longer attend, please contact the clinic.',
    ],
  };
});

export const adminRunReminderMail = defineTemplate(
  ({ timezone, appointments }: AdminRunReminderData) => {
    const [first] = appointments;
    const date = longDate(first.start, timezone);
    const startTime = time(first.start, timezone);
    const headline =
      appointments.length === 1
        ? `1 appointment at ${startTime}`
        : `${String(appointments.length)} appointments starting at ${startTime}`;

    return {
      subject: `Reminder: ${headline} on ${date}`,
      paragraphs: [
        `You have ${headline} on ${date} (${timezone} time):`,
        appointments
          .map((appointment) => `${timeRange(appointment, timezone)} · ${appointment.patientName}`)
          .join('\n'),
      ],
    };
  },
);
