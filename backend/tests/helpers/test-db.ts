import { randomUUID } from 'node:crypto';

import { createDatabase, type Database } from '@physiobook/db';
import { Client, type Pool } from 'pg';
import { inject } from 'vitest';

import { withDatabase } from './postgres-uri.js';

/**
 * A fresh database per test file (ticket 0.4).
 *
 * The container, the extensions from docker/postgres/init.sql and the
 * migrations are all done once, in global-setup.ts; this clones the template it
 * left behind. Postgres copies a template database file-by-file, so a clone
 * costs milliseconds — cheap enough that no test has a reason to share state
 * with another, which is what keeps the race and overlap tests independent.
 *
 * Usage:
 *
 *   let database: TestDatabase;
 *   beforeAll(async () => { database = await createTestDatabase(); });
 *   afterAll(async () => { await database?.drop(); });
 */

export interface TestDatabase {
  /** The clone's database name — useful in failure messages. */
  name: string;
  connectionString: string;
  /** Drizzle client, typed with the full schema. */
  db: Database;
  /** Raw pool, for DDL and anything else Drizzle is the wrong tool for. */
  pool: Pool;
  /** Closes the pool and drops the clone. Call it in `afterAll`. */
  drop: () => Promise<void>;
}

/**
 * Clones the migrated template into a database of this file's own.
 *
 * Only callable from a test worker: the connection details come from the global
 * setup via Vitest's `inject`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const { adminUri, templateDatabase } = inject('postgres');

  // A UUID, so parallel workers cannot collide on a name. Hyphens stripped
  // because an identifier containing them would have to stay quoted everywhere
  // it is typed by hand while debugging.
  const name = `test_${randomUUID().replaceAll('-', '')}`;

  const admin = new Client({ connectionString: adminUri });
  await admin.connect();
  try {
    // Interpolated because a database name is an identifier and cannot be a
    // bound parameter. Both values are generated above or fixed by the setup —
    // neither is input — and both are quoted.
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${templateDatabase}"`);
  } finally {
    await admin.end();
  }

  const connectionString = withDatabase(adminUri, name);
  const { db, pool, close } = createDatabase(connectionString);

  return {
    name,
    connectionString,
    db,
    pool,
    drop: async () => {
      await close();

      const cleanup = new Client({ connectionString: adminUri });
      await cleanup.connect();
      try {
        // WITH (FORCE) terminates any connection the test forgot to close.
        // Without it a single leaked client turns teardown into a "database is
        // being accessed by other users" failure that says nothing about the
        // test that leaked it.
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
