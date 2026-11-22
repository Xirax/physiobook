import { appointments, calendarBlocks, notificationLog, users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import type { Job } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSendCancellationHandler,
  sendCancellation,
} from '../../src/jobs/send-cancellation.job.js';
import type { Mailer } from '../../src/lib/mailer.js';
import { tstzrangeOf } from '../../src/lib/period.js';
import {
  createMailpitMailer,
  findMessages,
  uniqueRecipient,
  waitForMessage,
} from '../helpers/mailpit.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

// Thursday 2026-11-19 on CET: 09:00Z is 10:00 in Warsaw.
const START = new Date('2026-11-19T09:00:00.000Z');
const END = new Date('2026-11-19T10:00:00.000Z');
const CANCELLED_AT = new Date('2026-11-19T07:30:00.000Z');
const now = () => CANCELLED_AT;

type BlockStatus = 'active' | 'cancelled' | 'cancelled_by_admin';

describe('send-cancellation job', () => {
  let mailer: Mailer;
  let database: TestDatabase;

  const run = (appointmentId: string, deps: { mailer?: Mailer } = {}) =>
    sendCancellation(appointmentId, { db: database.db, mailer: deps.mailer ?? mailer, now });

  const book = async (status: BlockStatus = 'cancelled_by_admin') => {
    const email = uniqueRecipient('patient');
    const [patient] = await database.db
      .insert(users)
      .values({ email, passwordHash: 'x', fullName: 'Anna Nowak' })
      .returning({ id: users.id });
    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    const [block] = await database.db
      .insert(calendarBlocks)
      .values({
        practitionerId: admin!.id,
        kind: 'appointment',
        status,
        period: tstzrangeOf({ start: START, end: END }),
      })
      .returning({ id: calendarBlocks.id });
    const [appointment] = await database.db
      .insert(appointments)
      .values({ blockId: block!.id, userId: patient!.id })
      .returning({ id: appointments.id });

    return { id: appointment!.id, userId: patient!.id, email };
  };

  const logRows = () => database.db.select().from(notificationLog);

  beforeAll(() => {
    mailer = createMailpitMailer();
  });

  afterAll(() => {
    mailer?.close();
  });

  beforeEach(async () => {
    database = await createTestDatabase();
    await database.pool.query(`UPDATE practice_settings SET timezone = 'Europe/Warsaw'`);
  });

  afterEach(async () => {
    await database?.drop();
  });

  it('mails the patient of an admin-cancelled appointment and logs the send', async () => {
    const appointment = await book();

    await run(appointment.id);

    const mail = await waitForMessage(appointment.email);
    expect(mail.Subject).toBe('Cancelled: your appointment on Thursday 19 November 2026 at 10:00');
    expect(mail.Text).toContain('Thursday 19 November 2026, 10:00–11:00 (Europe/Warsaw time)');
    expect(await logRows()).toEqual([
      expect.objectContaining({
        dedupeKey: `cancellation:${appointment.id}`,
        type: 'cancellation_user',
        recipientRole: 'user',
        recipientUserId: appointment.userId,
        sentAt: CANCELLED_AT,
        payload: { to: appointment.email, subject: mail.Subject },
      }),
    ]);
  });

  it('sends one mail and logs one row when the job runs twice', async () => {
    const appointment = await book();

    await run(appointment.id);
    await run(appointment.id);

    await waitForMessage(appointment.email);
    expect(await logRows()).toHaveLength(1);
  });

  it('sends one mail when two deliveries of the job run concurrently', async () => {
    const appointment = await book();

    await Promise.all([run(appointment.id), run(appointment.id)]);

    await waitForMessage(appointment.email);
    expect(await logRows()).toHaveLength(1);
  });

  it('releases the claim when the send fails, so a retry still sends the mail', async () => {
    const appointment = await book();
    const failing: Mailer = {
      send: () => Promise.reject(new Error('SMTP down')),
      close: () => {},
    };

    await expect(run(appointment.id, { mailer: failing })).rejects.toThrow('SMTP down');
    expect(await logRows()).toEqual([]);

    await run(appointment.id);

    await waitForMessage(appointment.email);
    expect(await logRows()).toHaveLength(1);
  });

  it.each<BlockStatus>(['active', 'cancelled'])(
    'sends nothing for an appointment whose block is %s',
    async (status) => {
      const appointment = await book(status);

      await run(appointment.id);

      expect(await logRows()).toEqual([]);
      expect(await findMessages(appointment.email)).toEqual([]);
    },
  );

  it('sends nothing for an appointment that does not exist', async () => {
    await run('11111111-1111-4111-8111-111111111111');

    expect(await logRows()).toEqual([]);
  });

  describe('handler', () => {
    const jobWith = (data: unknown) => [{ id: 'job-1', name: 'send-cancellation', data }] as Job[];
    const handler = () => createSendCancellationHandler({ db: database.db, mailer, now });

    it('sends the cancellation mail for the appointment in its payload', async () => {
      const appointment = await book();

      await handler()(jobWith({ appointmentId: appointment.id }));

      await waitForMessage(appointment.email);
    });

    it('fails the job when the send fails, so pg-boss retries it', async () => {
      const appointment = await book();
      const failing = createSendCancellationHandler({
        db: database.db,
        mailer: { send: () => Promise.reject(new Error('SMTP down')), close: () => {} },
        now,
      });

      await expect(failing(jobWith({ appointmentId: appointment.id }))).rejects.toThrow(
        'SMTP down',
      );
    });

    it.each([
      ['no payload', null],
      ['a non-uuid id', { appointmentId: 'nope' }],
      ['an unknown field', { appointmentId: '4f1c2a52-6a47-4c5b-9b8e-3f2d1a0b9c7d', extra: 1 }],
    ])('fails the job for %s', async (_case, data) => {
      await expect(handler()(jobWith(data))).rejects.toThrow();
    });
  });
});
