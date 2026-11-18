import { describe, expect, it } from 'vitest';

import {
  adminRunReminderMail,
  type ReminderAppointment,
  userReminderMail,
} from './reminder-mail.js';

const WARSAW = 'Europe/Warsaw';

const appointment = (startIso: string, patientName: string): ReminderAppointment => {
  const start = new Date(startIso);

  return { start, end: new Date(start.getTime() + 3_600_000), patientName };
};

describe('userReminderMail', () => {
  const mail = userReminderMail({
    timezone: WARSAW,
    appointment: appointment('2026-11-19T09:00:00Z', 'Anna Nowak'),
  });

  it('names the date and start time in the practice timezone in the subject', () => {
    expect(mail.subject).toBe('Reminder: your appointment on Thursday 19 November 2026 at 10:00');
  });

  it('greets the patient and gives the local time range', () => {
    expect(mail.text).toContain('Hi Anna Nowak,');
    expect(mail.text).toContain('Thursday 19 November 2026, 10:00–11:00 (Europe/Warsaw time)');
  });

  it('renders across a DST change in the practice wall-clock time', () => {
    const summer = userReminderMail({
      timezone: WARSAW,
      appointment: appointment('2026-10-24T09:00:00Z', 'Anna Nowak'),
    });
    const winter = userReminderMail({
      timezone: WARSAW,
      appointment: appointment('2026-10-26T09:00:00Z', 'Anna Nowak'),
    });

    expect(summer.subject).toContain('Saturday 24 October 2026 at 11:00');
    expect(winter.subject).toContain('Monday 26 October 2026 at 10:00');
  });

  it('renders the local date when it differs from the UTC date', () => {
    const late = userReminderMail({
      timezone: WARSAW,
      appointment: appointment('2026-11-19T23:00:00Z', 'Anna Nowak'),
    });

    expect(late.subject).toContain('Friday 20 November 2026 at 00:00');
  });
});

describe('adminRunReminderMail', () => {
  it('uses singular wording for a run of one appointment', () => {
    const mail = adminRunReminderMail({
      timezone: WARSAW,
      appointments: [appointment('2026-11-19T09:00:00Z', 'Anna Nowak')],
    });

    expect(mail.subject).toBe('Reminder: 1 appointment at 10:00 on Thursday 19 November 2026');
    expect(mail.text).toContain('10:00–11:00 · Anna Nowak');
  });

  it('counts the run and lists every appointment in order for a run of several', () => {
    const mail = adminRunReminderMail({
      timezone: WARSAW,
      appointments: [
        appointment('2026-11-19T09:00:00Z', 'Anna Nowak'),
        appointment('2026-11-19T10:00:00Z', 'Jan Kowalski'),
        appointment('2026-11-19T11:00:00Z', 'Ewa Wiśniewska'),
      ],
    });

    expect(mail.subject).toBe(
      'Reminder: 3 appointments starting at 10:00 on Thursday 19 November 2026',
    );
    expect(mail.text).toContain(
      '10:00–11:00 · Anna Nowak\n11:00–12:00 · Jan Kowalski\n12:00–13:00 · Ewa Wiśniewska',
    );
  });
});
