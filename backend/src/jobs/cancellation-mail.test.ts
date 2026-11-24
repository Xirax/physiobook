import { describe, expect, it } from 'vitest';

import { cancellationMail } from './cancellation-mail.js';

const appointmentAt = (startIso: string, patientName = 'Anna Nowak') => {
  const start = new Date(startIso);

  return { start, end: new Date(start.getTime() + 3_600_000), patientName };
};

describe('cancellationMail', () => {
  const mail = cancellationMail({
    timezone: 'Europe/Warsaw',
    appointment: appointmentAt('2026-11-19T09:00:00Z'),
  });

  it('names the date and start time in the practice timezone in the subject', () => {
    expect(mail.subject).toBe('Cancelled: your appointment on Thursday 19 November 2026 at 10:00');
  });

  it('greets the patient and says the clinic cancelled the local time range', () => {
    expect(mail.text).toContain('Hi Anna Nowak,');
    expect(mail.text).toContain('the clinic has cancelled');
    expect(mail.text).toContain('Thursday 19 November 2026, 10:00–11:00 (Europe/Warsaw time)');
  });

  it('renders the local time on the summer side of a DST change', () => {
    const summer = cancellationMail({
      timezone: 'Europe/Warsaw',
      appointment: appointmentAt('2027-03-29T08:00:00Z'),
    });

    expect(summer.text).toContain('Monday 29 March 2027, 10:00–11:00');
  });

  it('escapes the patient name in the HTML part', () => {
    const html = cancellationMail({
      timezone: 'Europe/Warsaw',
      appointment: appointmentAt('2026-11-19T09:00:00Z', '<b>Eve</b>'),
    }).html;

    expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
    expect(html).not.toContain('<b>Eve</b>');
  });
});
