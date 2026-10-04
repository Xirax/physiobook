import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { QUEUES } from '../../src/jobs/boss.js';
import { noopHandler } from '../../src/jobs/noop.job.js';
import { startWorker, type Worker } from '../../src/jobs/worker.js';
import { buildTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

describe('API → worker', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let worker: Worker;
  const handler = vi.fn(noopHandler);

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString });
    worker = await startWorker({
      connectionString: database.connectionString,
      health: { port: 0, host: '127.0.0.1' },
      handlers: { noop: handler },
      logger: false,
    });
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await database?.drop();
  });

  it('has a job enqueued through the API processed by the worker exactly once', async () => {
    const id = await app.jobs.send(QUEUES.noop, { from: 'api' });

    await vi.waitFor(
      async () => {
        const [job] = await worker.boss.findJobs(QUEUES.noop, { id: id ?? '' });
        expect(job?.state).toBe('completed');
      },
      { timeout: 15_000, interval: 100 },
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ id, data: { from: 'api' } }),
    ]);
  });
});
