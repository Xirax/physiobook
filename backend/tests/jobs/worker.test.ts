import { createServer, type AddressInfo } from 'node:net';

import { appointments, calendarBlocks, users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import type { Job, PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoss, createJobQueue, QUEUES, startBoss } from '../../src/jobs/boss.js';
import { noopHandler } from '../../src/jobs/noop.job.js';
import { buildHealthServer, startWorker, type Worker } from '../../src/jobs/worker.js';
import type { Mailer } from '../../src/lib/mailer.js';
import { tstzrangeOf } from '../../src/lib/period.js';
import { createMailpitMailer, uniqueRecipient, waitForMessage } from '../helpers/mailpit.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

const JOB_SETTLED_TIMEOUT = { timeout: 15_000, interval: 100 };

const failOnError = (error: Error): never => {
  throw error;
};

describe('worker', () => {
  let database: TestDatabase;
  let api: PgBoss;
  let worker: Worker | undefined;
  let mailer: Mailer;

  const launch = async (
    handler = vi.fn(noopHandler),
    { mailer: workerMailer = mailer }: { mailer?: Mailer } = {},
  ): Promise<Worker> => {
    worker = await startWorker({
      connectionString: database.connectionString,
      health: { port: 0, host: '127.0.0.1' },
      mailer: workerMailer,
      handlers: { noop: handler },
      logger: false,
    });

    return worker;
  };

  const insertAppointment = async (
    label: string,
    status: 'active' | 'cancelled_by_admin' = 'active',
  ) => {
    const email = uniqueRecipient(label);
    const [patient] = await database.db
      .insert(users)
      .values({ email, passwordHash: 'x', fullName: 'Worker Patient' })
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
        period: tstzrangeOf({ start: '2026-11-19T09:00:00Z', end: '2026-11-19T10:00:00Z' }),
      })
      .returning({ id: calendarBlocks.id });
    const [appointment] = await database.db
      .insert(appointments)
      .values({ blockId: block!.id, userId: patient!.id })
      .returning({ id: appointments.id });

    return { id: appointment!.id, email };
  };

  const jobState = async (id: string): Promise<string | undefined> => {
    const [job] = await api.findJobs(QUEUES.noop, { id });

    return job?.state;
  };

  beforeAll(() => {
    mailer = createMailpitMailer();
  });

  afterAll(() => {
    mailer?.close();
  });

  beforeEach(async () => {
    database = await createTestDatabase();
    api = await startBoss(
      createBoss({
        connectionString: database.connectionString,
        role: 'api',
        onError: failOnError,
      }),
    );
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await api?.stop({ graceful: false });
    await database?.drop();
  });

  it('processes a no-op job enqueued by the API exactly once', async () => {
    const handler = vi.fn(noopHandler);
    await launch(handler);

    const id = await createJobQueue(api).send(QUEUES.noop, { probe: 1 });

    await vi.waitFor(async () => {
      expect(await jobState(id ?? '')).toBe('completed');
    }, JOB_SETTLED_TIMEOUT);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ id, data: { probe: 1 } }),
    ]);
    const [job] = await api.findJobs(QUEUES.noop, { id: id ?? '' });
    expect(job?.retryCount).toBe(0);
  });

  it('sends the reminder mail for a send-reminder job with its default handler', async () => {
    await launch();
    const appointment = await insertAppointment('worker-reminder');

    await createJobQueue(api).send(QUEUES.sendReminder, { appointmentId: appointment.id });

    const mail = await waitForMessage(appointment.email, { timeout: 15_000 });
    expect(mail.Subject).toContain('Reminder: your appointment');
  });

  it('sends the cancellation mail for a send-cancellation job with its default handler', async () => {
    await launch();
    const appointment = await insertAppointment('worker-cancellation', 'cancelled_by_admin');

    await createJobQueue(api).send(QUEUES.sendCancellation, { appointmentId: appointment.id });

    const mail = await waitForMessage(appointment.email, { timeout: 15_000 });
    expect(mail.Subject).toContain('Cancelled: your appointment');
  });

  it('retries a send-cancellation job whose send failed and mails the patient once', async () => {
    const send = vi
      .fn<Mailer['send']>()
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockImplementation((message) => mailer.send(message));
    await launch(undefined, { mailer: { send, close: () => {} } });
    const appointment = await insertAppointment('worker-retry', 'cancelled_by_admin');

    const id = await createJobQueue(api).send(QUEUES.sendCancellation, {
      appointmentId: appointment.id,
    });

    await vi.waitFor(async () => {
      const [job] = await api.findJobs(QUEUES.sendCancellation, { id: id ?? '' });
      expect(job).toMatchObject({ state: 'completed', retryCount: 1 });
    }, JOB_SETTLED_TIMEOUT);
    await waitForMessage(appointment.email);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports healthy on /health over HTTP while connected', async () => {
    const { health } = await launch();
    const { port } = health.server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports unavailable on /health once pg-boss has lost its connection', async () => {
    const boss = await startBoss(
      createBoss({
        connectionString: database.connectionString,
        role: 'worker',
        onError: failOnError,
      }),
    );
    await boss.stop({ graceful: false });
    const health = buildHealthServer(boss, false);

    const response = await health.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
    await health.close();
  });

  it('lets an in-flight job finish before a graceful close resolves', async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = vi.fn();
    const events: string[] = [];
    const slowHandler = vi.fn(async (_jobs: Job<unknown>[]) => {
      started();
      await released;
      events.push('job finished');
    });
    const running = await launch(slowHandler);

    const id = await createJobQueue(api).send(QUEUES.noop);
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalled();
    }, JOB_SETTLED_TIMEOUT);

    const closing = running.close().then(() => events.push('closed'));
    // Long enough that a close() which did not wait for the job would win.
    setTimeout(release, 1_000);
    await closing;
    worker = undefined;

    expect(events).toEqual(['job finished', 'closed']);
    expect(await jobState(id ?? '')).toBe('completed');
  });

  it('closes the health server even when stopping pg-boss fails', async () => {
    const running = await launch();
    vi.spyOn(running.boss, 'stop').mockRejectedValueOnce(new Error('stop failed'));

    await expect(running.close()).rejects.toThrow('stop failed');

    expect(running.health.server.listening).toBe(false);
  });

  it('keeps running when pg-boss reports an error', async () => {
    const running = await launch();

    expect(() => running.boss.emit('error', new Error('connection terminated'))).not.toThrow();
  });

  it('releases its database connections when the health port cannot be bound', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address() as AddressInfo;

    try {
      await expect(
        startWorker({
          connectionString: database.connectionString,
          health: { port, host: '127.0.0.1' },
          mailer,
          logger: false,
        }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      blocker.close();
    }

    const { rows } = await database.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'physiobook-worker' AND datname = current_database()",
    );
    expect(rows[0]?.count).toBe(0);
  });
});
