import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createBoss,
  createJobQueue,
  type JobQueue,
  QUEUES,
  startBoss,
} from '../../src/jobs/boss.js';
import { transactionDb } from '../../src/jobs/transaction-db.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

class Rollback extends Error {}

describe('enqueueing inside a Drizzle transaction', () => {
  let database: TestDatabase;
  let boss: PgBoss;
  let jobs: JobQueue;

  const findJob = async (id: string) => (await boss.findJobs(QUEUES.noop, { id }))[0];

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
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await database?.drop();
  });

  it('creates the job when the transaction commits', async () => {
    const id = await database.db.transaction((tx) =>
      jobs.send(QUEUES.noop, { probe: 'commit' }, { db: transactionDb(tx) }),
    );

    expect(await findJob(id ?? '')).toMatchObject({ state: 'created', data: { probe: 'commit' } });
  });

  it('leaves no job behind when the transaction rolls back', async () => {
    let id: string | null = null;

    await expect(
      database.db.transaction(async (tx) => {
        id = await jobs.send(QUEUES.noop, { probe: 'rollback' }, { db: transactionDb(tx) });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(id).toEqual(expect.any(String));
    expect(await findJob(id ?? '')).toBeUndefined();
  });
});
