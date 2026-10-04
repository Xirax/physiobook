import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

/**
 * Tests of the harness itself (ticket 0.4).
 *
 * Everything DB-backed in this repo is only as trustworthy as the database it
 * runs on, so the two properties the harness promises — migrations applied, and
 * one database per test file — are asserted rather than assumed.
 */
describe('test database harness', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  it('has the migration runner applied to the template it cloned', async () => {
    // Drizzle's bookkeeping table, created by the first `migrate()` call even
    // when there is nothing to apply. Its presence proves runMigrations() ran
    // against the template — the assertion that will still be here, unchanged,
    // once 1.1 gives it rows to hold.
    const result = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'`,
    );

    expect(result.rows[0]?.count).toBe('1');
  });

  it('runs on a server with durability off, so DROP DATABASE checkpoints stay cheap', async () => {
    const settings = await database.pool.query<{ name: string; setting: string }>(
      `SELECT name, setting FROM pg_settings
        WHERE name IN ('fsync', 'synchronous_commit', 'full_page_writes')
        ORDER BY name`,
    );

    expect(settings.rows).toEqual([
      { name: 'fsync', setting: 'off' },
      { name: 'full_page_writes', setting: 'off' },
      { name: 'synchronous_commit', setting: 'off' },
    ]);
  });

  it('gives each caller an isolated database', async () => {
    // Two clones in one file, so the assertion is deterministic — proving it
    // across files would depend on the order Vitest happened to run them in.
    const other = await createTestDatabase();

    try {
      expect(other.name).not.toBe(database.name);

      await database.pool.query('CREATE TABLE isolation_probe (id integer PRIMARY KEY)');

      await expect(other.pool.query('SELECT * FROM isolation_probe')).rejects.toThrow(
        /relation "isolation_probe" does not exist/,
      );
    } finally {
      await other.drop();
    }
  });
});
