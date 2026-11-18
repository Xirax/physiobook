import { appointments, calendarBlocks, notificationLog, users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import type { Job } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSendReminderHandler, sendReminders } from '../../src/jobs/send-reminder.job.js';
import { createMailer, type Mailer } from '../../src/lib/mailer.js';
import { tstzrangeOf } from '../../src/lib/period.js';
import {
  findMessages,
  mailpitConfig,
  uniqueRecipient,
  waitForMessage,
} from '../helpers/mailpit.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

const HOUR_MS = 3_600_000;
// Thursday 2026-11-19 on CET: 09:00Z is 10:00 in Warsaw.
const TEN = '2026-11-19T09:00:00.000Z';
const hoursAfterTen = (hours: number) => new Date(Date.parse(TEN) + hours * HOUR_MS);
const FIRED_AT = hoursAfterTen(-24);
const now = () => FIRED_AT;

describe('send-reminder job', () => {
  let mailer: Mailer;
  let database: TestDatabase;
  let adminId: string;
  let adminEmail: string;

  const run = (appointmentId: string, deps: { mailer?: Mailer } = {}) =>
    sendReminders(appointmentId, { db: database.db, mailer: deps.mailer ?? mailer, now });

  const book = async (hoursFromTen: number, patientName: string, practitionerId = adminId) => {
    const email = uniqueRecipient('patient');
    const [patient] = await database.db
      .insert(users)
      .values({ email, passwordHash: 'x', fullName: patientName })
      .returning({ id: users.id });
    const start = hoursAfterTen(hoursFromTen);
    const [block] = await database.db
      .insert(calendarBlocks)
      .values({
        practitionerId,
        kind: 'appointment',
        period: tstzrangeOf({ start, end: new Date(start.getTime() + HOUR_MS) }),
      })
      .returning({ id: calendarBlocks.id });
    const [appointment] = await database.db
      .insert(appointments)
      .values({ blockId: block!.id, userId: patient!.id })
      .returning({ id: appointments.id });

    return { id: appointment!.id, blockId: block!.id, email };
  };

  const cancel = ({ blockId }: { blockId: string }) =>
    database.db
      .update(calendarBlocks)
      .set({ status: 'cancelled' })
      .where(eq(calendarBlocks.id, blockId));

  const logRows = () => database.db.select().from(notificationLog);

  const adminSubjects = async () =>
    (await findMessages(adminEmail)).map((mail) => mail.Subject).sort();

  const waitForAdminSubjects = (expected: string[]) =>
    vi.waitFor(
      async () => {
        expect(await adminSubjects()).toEqual(expected);
      },
      { timeout: 5_000, interval: 100 },
    );

  beforeAll(() => {
    const { host, smtpPort } = mailpitConfig();
    mailer = createMailer({
      host,
      port: smtpPort,
      secure: false,
      from: 'no-reply@physiobook.local',
    });
  });

  afterAll(() => {
    mailer?.close();
  });

  beforeEach(async () => {
    database = await createTestDatabase();
    adminEmail = uniqueRecipient('admin');
    const [admin] = await database.db
      .update(users)
      .set({ email: adminEmail })
      .where(eq(users.role, 'admin'))
      .returning({ id: users.id });
    adminId = admin!.id;
    await database.pool.query(`UPDATE practice_settings SET timezone = 'Europe/Warsaw'`);
  });

  afterEach(async () => {
    await database?.drop();
  });

  it('sends a single appointment its user reminder and a singular admin reminder', async () => {
    const appointment = await book(0, 'Anna Nowak');

    await run(appointment.id);

    const userMail = await waitForMessage(appointment.email);
    expect(userMail.Subject).toBe(
      'Reminder: your appointment on Thursday 19 November 2026 at 10:00',
    );
    const adminMail = await waitForMessage(adminEmail);
    expect(adminMail.Subject).toBe('Reminder: 1 appointment at 10:00 on Thursday 19 November 2026');
    expect(adminMail.Text).toContain('10:00–11:00 · Anna Nowak');

    expect(await logRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey: `reminder:user:${appointment.id}`,
          type: 'reminder_user',
          recipientRole: 'user',
          sentAt: FIRED_AT,
        }),
        expect.objectContaining({
          dedupeKey: `reminder:admin-run:${adminId}:${TEN}`,
          type: 'reminder_admin_grouped',
          recipientRole: 'admin',
          recipientUserId: adminId,
          sentAt: FIRED_AT,
        }),
      ]),
    );
  });

  it('groups three consecutive appointments into one plural admin mail', async () => {
    const run3 = [await book(0, 'Anna'), await book(1, 'Jan'), await book(2, 'Ewa')];

    for (const appointment of [...run3].reverse()) await run(appointment.id);

    for (const appointment of run3) await waitForMessage(appointment.email);
    const adminMail = await waitForMessage(adminEmail);
    expect(adminMail.Subject).toBe(
      'Reminder: 3 appointments starting at 10:00 on Thursday 19 November 2026',
    );
    expect(adminMail.Text.replaceAll('\r\n', '\n')).toContain(
      '10:00–11:00 · Anna\n11:00–12:00 · Jan\n12:00–13:00 · Ewa',
    );
    expect(await logRows()).toHaveLength(4);
  });

  it('excludes an appointment cancelled before the reminder fires from the admin count', async () => {
    const first = await book(0, 'Anna');
    const second = await book(1, 'Jan');
    const cancelled = await book(2, 'Ewa');
    await cancel(cancelled);

    for (const appointment of [first, second, cancelled]) await run(appointment.id);

    const adminMail = await waitForMessage(adminEmail);
    expect(adminMail.Subject).toContain('2 appointments starting at 10:00');
    expect(adminMail.Text).not.toContain('Ewa');
    expect(await findMessages(cancelled.email)).toEqual([]);
    expect(await logRows()).toHaveLength(3);
  });

  it('lets the next active appointment send the grouped mail when the run start is cancelled', async () => {
    const cancelled = await book(0, 'Anna');
    const second = await book(1, 'Jan');
    const third = await book(2, 'Ewa');
    await cancel(cancelled);

    for (const appointment of [cancelled, second, third]) await run(appointment.id);

    const adminMail = await waitForMessage(adminEmail);
    expect(adminMail.Subject).toContain('2 appointments starting at 11:00');
    expect(await findMessages(cancelled.email)).toEqual([]);
    expect((await logRows()).map((row) => row.dedupeKey)).toContain(
      `reminder:admin-run:${adminId}:${hoursAfterTen(1).toISOString()}`,
    );
  });

  it('splits a run in two when an appointment in the middle is cancelled', async () => {
    const first = await book(0, 'Anna');
    const middle = await book(1, 'Jan');
    const last = await book(2, 'Ewa');
    await cancel(middle);

    for (const appointment of [first, middle, last]) await run(appointment.id);

    await waitForAdminSubjects([
      'Reminder: 1 appointment at 10:00 on Thursday 19 November 2026',
      'Reminder: 1 appointment at 12:00 on Thursday 19 November 2026',
    ]);
  });

  it('sends each practitioner their own admin mail for runs starting at the same instant', async () => {
    // A second practitioner as a plain user row: the single-admin index forbids
    // a second admin, but calendar_blocks.practitioner_id only references users.
    const otherEmail = uniqueRecipient('other-practitioner');
    const [other] = await database.db
      .insert(users)
      .values({ email: otherEmail, passwordHash: 'x', fullName: 'Other Practitioner' })
      .returning({ id: users.id });
    const ours = await book(0, 'Anna');
    const theirs = await book(0, 'Jan', other!.id);

    await run(ours.id);
    await run(theirs.id);

    expect((await waitForMessage(adminEmail)).Text).toContain('Anna');
    expect((await waitForMessage(otherEmail)).Text).toContain('Jan');
  });

  it('sends separate admin mails for appointments that are not back to back', async () => {
    const morning = await book(0, 'Anna');
    const later = await book(3, 'Jan');

    await run(morning.id);
    await run(later.id);

    await waitForAdminSubjects([
      'Reminder: 1 appointment at 10:00 on Thursday 19 November 2026',
      'Reminder: 1 appointment at 13:00 on Thursday 19 November 2026',
    ]);
  });

  it('sends one mail and logs one row per key when the job runs twice', async () => {
    const appointment = await book(0, 'Anna');

    await run(appointment.id);
    await run(appointment.id);

    await waitForMessage(appointment.email);
    await waitForMessage(adminEmail);
    expect(await logRows()).toHaveLength(2);
  });

  it('sends one mail when two deliveries of the job run concurrently', async () => {
    const appointment = await book(0, 'Anna');

    await Promise.all([run(appointment.id), run(appointment.id)]);

    await waitForMessage(appointment.email);
    await waitForMessage(adminEmail);
    expect(await logRows()).toHaveLength(2);
  });

  it('sends nothing for a cancelled appointment', async () => {
    const appointment = await book(0, 'Anna');
    await cancel(appointment);

    await run(appointment.id);

    expect(await logRows()).toEqual([]);
    expect(await findMessages(appointment.email)).toEqual([]);
  });

  it('sends nothing for an appointment that does not exist', async () => {
    await run('11111111-1111-4111-8111-111111111111');

    expect(await logRows()).toEqual([]);
  });

  it('releases the claim when the send fails, so a retry still sends the mail', async () => {
    const appointment = await book(0, 'Anna');
    const failing: Mailer = {
      send: () => Promise.reject(new Error('SMTP down')),
      close: () => {},
    };

    await expect(run(appointment.id, { mailer: failing })).rejects.toThrow('SMTP down');
    expect(await logRows()).toEqual([]);

    await run(appointment.id);

    await waitForMessage(appointment.email);
    await waitForMessage(adminEmail);
    expect(await logRows()).toHaveLength(2);
  });

  describe('handler', () => {
    const jobWith = (data: unknown) => [{ id: 'job-1', name: 'send-reminder', data }] as Job[];

    it('sends the reminders for the appointment in its payload', async () => {
      const appointment = await book(0, 'Anna');
      const handler = createSendReminderHandler({ db: database.db, mailer, now });

      await handler(jobWith({ appointmentId: appointment.id }));

      await waitForMessage(appointment.email);
    });

    it('fails the job on a malformed payload', async () => {
      const handler = createSendReminderHandler({ db: database.db, mailer, now });

      await expect(handler(jobWith({ appointmentId: 'not-a-uuid' }))).rejects.toThrow();
    });
  });
});
