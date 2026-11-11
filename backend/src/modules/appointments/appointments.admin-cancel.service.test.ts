import { randomUUID } from 'node:crypto';

import { users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBoss, createJobQueue, type JobQueue, QUEUES, startBoss } from '../../jobs/boss.js';
import {
  AlreadyCancelledError,
  AppointmentAlreadyStartedError,
  NotFoundError,
} from '../../lib/errors.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { replaceBusinessHours } from '../availability/business-hours.service.js';
import { updateSettings } from '../settings/settings.service.js';

import { adminCancelAppointment, bookAppointment } from './appointments.service.js';

// Monday 2026-11-02 on CET: the 09:00-13:00 Warsaw window is 08:00-12:00Z.
const BOOKED_AT = new Date('2026-11-01T12:00:00Z');
const START = '2026-11-02T10:00:00.000Z';
const minutesBeforeStart = (minutes: number) => new Date(Date.parse(START) - minutes * 60_000);
const SAME_DAY = minutesBeforeStart(30);

describe('adminCancelAppointment', () => {
  let database: TestDatabase;
  let boss: PgBoss;
  let jobs: JobQueue;
  let adminId: string;
  let patientId: string;

  const book = (now = BOOKED_AT) =>
    bookAppointment(patientId, { start: START }, { db: database.db, now: () => now });

  const cancel = (id: string, { now = SAME_DAY, queue = jobs } = {}) =>
    adminCancelAppointment(adminId, id, { db: database.db, now: () => now, jobs: queue });

  const blockStatusOf = async (appointmentId: string) => {
    const { rows } = await database.pool.query<{ status: string }>(
      `SELECT b.status FROM appointments a JOIN calendar_blocks b ON b.id = a.block_id
        WHERE a.id = $1`,
      [appointmentId],
    );
    return rows[0]!.status;
  };

  const setBlockStatus = (appointmentId: string, status: 'cancelled' | 'cancelled_by_admin') =>
    database.pool.query(
      `UPDATE calendar_blocks SET status = $2
        WHERE id = (SELECT block_id FROM appointments WHERE id = $1)`,
      [appointmentId, status],
    );

  const cancellationJobsFor = (appointmentId: string) =>
    boss.findJobs(QUEUES.sendCancellation, { data: { appointmentId } });

  beforeAll(async () => {
    database = await createTestDatabase();
    boss = await startBoss(
      createBoss({
        connectionString: database.connectionString,
        role: 'api',
        onError: (error) => {
          throw error;
        },
      }),
    );
    jobs = createJobQueue(boss);

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    adminId = admin!.id;

    const [patient] = await database.db
      .insert(users)
      .values({ email: 'pat@example.com', passwordHash: 'not-a-real-hash', fullName: 'Pat' })
      .returning({ id: users.id });
    patientId = patient!.id;

    await updateSettings(
      { timezone: 'Europe/Warsaw', reminder_lead_hours: 24, cancellation_cutoff_hours: 24 },
      { db: database.db },
    );
    await replaceBusinessHours(
      { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] },
      { db: database.db },
    );
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await database?.drop();
  });

  it('Cancels a same-day appointment inside the user cutoff as cancelled_by_admin', async () => {
    const { id } = await book();

    await expect(cancel(id)).resolves.toEqual({
      id,
      start: START,
      end: '2026-11-02T11:00:00.000Z',
      status: 'cancelled_by_admin',
    });
    expect(await blockStatusOf(id)).toBe('cancelled_by_admin');
  });

  it('Enqueues exactly one send-cancellation job naming the appointment', async () => {
    const { id } = await book();

    await cancel(id);

    const queued = await cancellationJobsFor(id);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ state: 'created', data: { appointmentId: id } });
  });

  it('Frees the slot so it can be booked again', async () => {
    const { id } = await book();
    await cancel(id);

    await expect(book(SAME_DAY)).resolves.toMatchObject({ start: START, status: 'active' });
  });

  it.each([
    ['at the start', minutesBeforeStart(0)],
    ['after the start', minutesBeforeStart(-90)],
  ])(
    'Rejects a cancel %s with AppointmentAlreadyStartedError and enqueues nothing',
    async (_, now) => {
      const { id } = await book();

      await expect(cancel(id, { now })).rejects.toBeInstanceOf(AppointmentAlreadyStartedError);
      expect(await blockStatusOf(id)).toBe('active');
      expect(await cancellationJobsFor(id)).toHaveLength(0);
    },
  );

  it.each(['cancelled', 'cancelled_by_admin'] as const)(
    'Rejects cancelling a %s appointment with AlreadyCancelledError and enqueues nothing',
    async (status) => {
      const { id } = await book();
      await setBlockStatus(id, status);

      await expect(cancel(id)).rejects.toBeInstanceOf(AlreadyCancelledError);
      expect(await blockStatusOf(id)).toBe(status);
      expect(await cancellationJobsFor(id)).toHaveLength(0);
    },
  );

  it('Answers NotFoundError for an id that does not exist', async () => {
    await expect(cancel(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('Answers NotFoundError for the id of a time-off block', async () => {
    const { rows } = await database.pool.query<{ id: string }>(
      `INSERT INTO calendar_blocks (practitioner_id, kind, period)
       VALUES ($1, 'time_off', tstzrange($2, $3, '[)')) RETURNING id`,
      [adminId, START, '2026-11-02T11:00:00Z'],
    );

    await expect(cancel(rows[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Answers NotFoundError for another practitioner's appointment and leaves it active", async () => {
    const [otherPractitioner] = await database.db
      .insert(users)
      .values({ email: 'doc@example.com', passwordHash: 'not-a-real-hash', fullName: 'Doc' })
      .returning({ id: users.id });
    const { rows } = await database.pool.query<{ id: string }>(
      `WITH block AS (
         INSERT INTO calendar_blocks (practitioner_id, kind, period)
         VALUES ($1, 'appointment', tstzrange($2, $3, '[)')) RETURNING id
       )
       INSERT INTO appointments (block_id, user_id) SELECT id, $4 FROM block RETURNING id`,
      [otherPractitioner!.id, START, '2026-11-02T11:00:00Z', patientId],
    );
    const id = rows[0]!.id;

    await expect(cancel(id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await blockStatusOf(id)).toBe('active');
  });

  it('Keeps the appointment active when the job cannot be enqueued', async () => {
    const { id } = await book();
    const failingQueue: JobQueue = { send: () => Promise.reject(new Error('queue down')) };

    await expect(cancel(id, { queue: failingQueue })).rejects.toThrow('queue down');
    expect(await blockStatusOf(id)).toBe('active');
  });

  it('Lets exactly one of two concurrent cancels succeed and enqueue', async () => {
    const { id } = await book();

    const results = await Promise.allSettled([cancel(id), cancel(id)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((result) => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(AlreadyCancelledError);
    expect(await cancellationJobsFor(id)).toHaveLength(1);
  });
});
