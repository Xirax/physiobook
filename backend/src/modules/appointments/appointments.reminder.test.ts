import { users } from '@physiobook/db';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBoss, createJobQueue, type JobQueue, QUEUES, startBoss } from '../../jobs/boss.js';
import { SlotTakenError } from '../../lib/errors.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { replaceBusinessHours } from '../availability/business-hours.service.js';
import { updateSettings } from '../settings/settings.service.js';

import { bookAppointment } from './appointments.service.js';

const HOUR_MS = 3_600_000;
// Monday 2026-11-02 on CET: the 09:00-13:00 Warsaw window is 08:00-12:00Z.
const START = '2026-11-02T10:00:00.000Z';
const hoursBeforeStart = (hours: number) => new Date(Date.parse(START) - hours * HOUR_MS);

describe('reminder scheduling on booking', () => {
  let database: TestDatabase;
  let boss: PgBoss;
  let jobs: JobQueue;
  let patientId: string;

  const setLeadHours = (reminderLeadHours: number) =>
    updateSettings(
      {
        timezone: 'Europe/Warsaw',
        reminder_lead_hours: reminderLeadHours,
        cancellation_cutoff_hours: 24,
      },
      { db: database.db },
    );

  const book = (now: Date) =>
    bookAppointment(patientId, { start: START }, { db: database.db, now: () => now, jobs });

  const remindersFor = (appointmentId: string) =>
    boss.findJobs(QUEUES.sendReminder, { data: { appointmentId } });

  const allReminders = () => boss.findJobs(QUEUES.sendReminder);

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

    const [patient] = await database.db
      .insert(users)
      .values({ email: 'remind-me@example.com', passwordHash: 'x', fullName: 'Remind Me' })
      .returning({ id: users.id });
    patientId = patient!.id;

    await replaceBusinessHours(
      { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] },
      { db: database.db },
    );
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
    await database.pool.query('DELETE FROM pgboss.job');
    await setLeadHours(24);
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await database?.drop();
  });

  it('schedules one send-reminder job at start minus the lead time', async () => {
    const { id } = await book(hoursBeforeStart(26));

    const reminders = await remindersFor(id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ state: 'created', data: { appointmentId: id } });
    expect(reminders[0]?.startAfter).toEqual(hoursBeforeStart(24));
  });

  it('schedules nothing when the appointment is booked inside the reminder window', async () => {
    await expect(book(hoursBeforeStart(23))).resolves.toMatchObject({ status: 'active' });

    expect(await allReminders()).toEqual([]);
  });

  it('schedules nothing when booked exactly at the reminder time', async () => {
    await book(hoursBeforeStart(24));

    expect(await allReminders()).toEqual([]);
  });

  it('uses the lead time configured when the appointment is booked', async () => {
    await setLeadHours(48);

    const { id } = await book(hoursBeforeStart(72));

    const [reminder] = await remindersFor(id);
    expect(reminder?.startAfter).toEqual(hoursBeforeStart(48));
  });

  it('does not reschedule an existing reminder when the lead time changes later', async () => {
    const { id } = await book(hoursBeforeStart(72));

    await setLeadHours(48);

    const reminders = await remindersFor(id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.startAfter).toEqual(hoursBeforeStart(24));
  });

  it('schedules no reminder for a booking that loses the slot', async () => {
    const { id } = await book(hoursBeforeStart(26));

    await expect(book(hoursBeforeStart(26))).rejects.toBeInstanceOf(SlotTakenError);

    const reminders = await allReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.data).toEqual({ appointmentId: id });
  });

  it('rolls back the booking when the reminder cannot be scheduled', async () => {
    const failing: JobQueue = { send: () => Promise.reject(new Error('queue down')) };

    await expect(
      bookAppointment(
        patientId,
        { start: START },
        { db: database.db, now: () => hoursBeforeStart(26), jobs: failing },
      ),
    ).rejects.toThrow('queue down');

    const { rows } = await database.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM calendar_blocks',
    );
    expect(rows[0]?.count).toBe(0);
  });
});
