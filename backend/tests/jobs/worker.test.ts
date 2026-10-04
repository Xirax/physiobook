import { createServer, type AddressInfo } from 'node:net';

import type { Job, PgBoss } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoss, createJobQueue, QUEUES, startBoss } from '../../src/jobs/boss.js';
import { noopHandler } from '../../src/jobs/noop.job.js';
import { buildHealthServer, startWorker, type Worker } from '../../src/jobs/worker.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

const JOB_SETTLED_TIMEOUT = { timeout: 15_000, interval: 100 };

const failOnError = (error: Error): never => {
  throw error;
};

describe('worker', () => {
  let database: TestDatabase;
  let api: PgBoss;
  let worker: Worker | undefined;

  const launch = async (handler = vi.fn(noopHandler)): Promise<Worker> => {
    worker = await startWorker({
      connectionString: database.connectionString,
      health: { port: 0, host: '127.0.0.1' },
      handlers: { noop: handler },
      logger: false,
    });

    return worker;
  };

  const jobState = async (id: string): Promise<string | undefined> => {
    const [job] = await api.findJobs(QUEUES.noop, { id });

    return job?.state;
  };

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
