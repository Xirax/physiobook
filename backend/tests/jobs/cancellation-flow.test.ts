import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { QUEUES, type QueueName } from '../../src/jobs/boss.js';
import { startWorker, type Worker } from '../../src/jobs/worker.js';
import type { Mailer } from '../../src/lib/mailer.js';
import {
  createMailpitMailer,
  findMessages,
  uniqueRecipient,
  waitForMessage,
} from '../helpers/mailpit.js';
import { buildTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

// Far enough ahead that the reminder job stays deferred until a test releases it.
// Monday 2030-11-04 on CET: 10:00Z is 11:00 in Warsaw.
const BOOKED_AT = new Date('2030-11-03T09:00:00Z');
const CANCELLED_AT = new Date('2030-11-04T09:30:00Z');
const START = '2030-11-04T10:00:00.000Z';
const TOKENS_OUTLIVE_THE_CLOCK_JUMP = 7 * 24 * 3600;
const JOB_SETTLED_TIMEOUT = { timeout: 15_000, interval: 100 };

describe('admin hard-cancel → cancellation email', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let worker: Worker;
  let mailer: Mailer;
  let now = BOOKED_AT;
  let patientEmail: string;
  let patientToken: string;
  let adminToken: string;

  const asUser = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

  const jobFor = async (queue: QueueName, appointmentId: string) => {
    const [job] = await worker.boss.findJobs<{ appointmentId: string }>(queue, {
      data: { appointmentId },
    });

    if (job === undefined) throw new Error(`no ${queue} job for ${appointmentId}`);

    return job;
  };

  const waitUntilCompleted = (queue: QueueName, id: string) =>
    vi.waitFor(async () => {
      const [job] = await worker.boss.findJobs(queue, { id });
      expect(job?.state).toBe('completed');
    }, JOB_SETTLED_TIMEOUT);

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({
      databaseUrl: database.connectionString,
      now: () => now,
      jwtTtlSeconds: TOKENS_OUTLIVE_THE_CLOCK_JUMP,
    });
    mailer = createMailpitMailer();
    worker = await startWorker({
      connectionString: database.connectionString,
      health: { port: 0, host: '127.0.0.1' },
      mailer,
      logger: false,
    });

    patientEmail = uniqueRecipient('cancel-flow');
    patientToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: patientEmail, password: 'correct-horse-battery', full_name: 'Nora' },
      })
    ).json().token;
    adminToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@physiobook.local', password: 'ChangeMe123!' },
      })
    ).json().token;

    await app.inject({
      method: 'PUT',
      url: '/settings',
      ...asUser(adminToken),
      payload: {
        timezone: 'Europe/Warsaw',
        reminder_lead_hours: 24,
        cancellation_cutoff_hours: 24,
      },
    });
    await app.inject({
      method: 'PUT',
      url: '/business-hours',
      ...asUser(adminToken),
      payload: { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] },
    });
  });

  afterAll(async () => {
    await worker?.close();
    mailer?.close();
    await app?.close();
    await database?.drop();
  });

  it('mails the patient once, and their pending reminder sends nothing', async () => {
    now = BOOKED_AT;
    const booking = await app.inject({
      method: 'POST',
      url: '/appointments',
      payload: { start: START },
      ...asUser(patientToken),
    });
    expect(booking.statusCode).toBe(201);
    const appointmentId: string = booking.json().id;
    const reminder = await jobFor(QUEUES.sendReminder, appointmentId);

    now = CANCELLED_AT;
    const cancel = await app.inject({
      method: 'POST',
      url: `/admin/appointments/${appointmentId}/cancel`,
      ...asUser(adminToken),
    });
    expect(cancel.statusCode).toBe(200);

    const mail = await waitForMessage(patientEmail, { timeout: 15_000 });
    expect(mail.Subject).toBe('Cancelled: your appointment on Monday 4 November 2030 at 11:00');

    await database.pool.query('UPDATE pgboss.job SET start_after = now() WHERE id = $1', [
      reminder.id,
    ]);
    await waitUntilCompleted(QUEUES.sendReminder, reminder.id);

    const resent = await app.jobs.send(QUEUES.sendCancellation, { appointmentId });
    await waitUntilCompleted(QUEUES.sendCancellation, resent ?? '');

    expect((await findMessages(patientEmail)).map((message) => message.Subject)).toEqual([
      mail.Subject,
    ]);
    const { rows } = await database.pool.query<{ dedupe_key: string }>(
      'SELECT dedupe_key FROM notification_log',
    );
    expect(rows).toEqual([{ dedupe_key: `cancellation:${appointmentId}` }]);
  });
});
