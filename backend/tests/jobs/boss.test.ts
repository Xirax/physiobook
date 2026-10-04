import type { PgBoss } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoss, createJobQueue, QUEUES, startBoss } from '../../src/jobs/boss.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

const failOnError = (error: Error): never => {
  throw error;
};

async function pgBossSchemaExists(database: TestDatabase): Promise<boolean> {
  const { rows } = await database.pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss') AS exists",
  );

  return rows[0]?.exists ?? false;
}

describe('pg-boss setup', () => {
  let database: TestDatabase;
  const started: PgBoss[] = [];

  const start = async (role: 'api' | 'worker'): Promise<PgBoss> => {
    const boss = createBoss({
      connectionString: database.connectionString,
      role,
      onError: failOnError,
    });
    started.push(boss);

    return startBoss(boss);
  };

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((boss) => boss.stop({ graceful: false })));
    await database?.drop();
  });

  it('creates its own schema on start', async () => {
    expect(await pgBossSchemaExists(database)).toBe(false);

    await start('api');

    expect(await pgBossSchemaExists(database)).toBe(true);
  });

  it('creates every queue the app uses', async () => {
    const boss = await start('worker');

    for (const name of Object.values(QUEUES)) {
      expect(await boss.getQueue(name)).toMatchObject({ name });
    }
  });

  it('lets the API and the worker start against the same database', async () => {
    const [api, worker] = await Promise.all([start('api'), start('worker')]);

    expect(await api.getQueue(QUEUES.noop)).not.toBeNull();
    expect(await worker.getQueue(QUEUES.noop)).not.toBeNull();
  });

  it('enqueues through the job queue without consuming the job', async () => {
    const boss = await start('api');

    const id = await createJobQueue(boss).send(QUEUES.noop, { probe: true });

    expect(id).toEqual(expect.any(String));
    const [job] = await boss.findJobs(QUEUES.noop, { id: id ?? '' });
    expect(job).toMatchObject({ state: 'created', data: { probe: true } });
  });

  it('routes pg-boss errors to onError instead of crashing the process', () => {
    const onError = vi.fn();
    const boss = createBoss({ connectionString: database.connectionString, role: 'api', onError });
    const error = new Error('connection terminated');

    expect(() => boss.emit('error', error)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
