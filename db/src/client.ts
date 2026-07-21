import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

/**
 * The Drizzle client, on node-postgres (CLAUDE.md §2).
 *
 * Created from an explicit connection string rather than reading `process.env`
 * itself: the backend passes its validated env, the test harness passes a
 * throwaway container's URL, and neither can accidentally reach the other's
 * database. Environment resolution for the CLI scripts lives in env.ts.
 */

/**
 * A Drizzle instance typed with the full schema, so relational queries and
 * `db.query.*` know every table. Import this type instead of writing
 * `NodePgDatabase<typeof schema>` at each call site.
 */
export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  /**
   * The underlying pool, for the few things Drizzle is the wrong tool for —
   * DDL in test fixtures, `LISTEN/NOTIFY`, session-scoped settings.
   */
  pool: Pool;
  /** Closes every pooled connection. Nothing may use `db` afterwards. */
  close: () => Promise<void>;
}

/**
 * Builds a pooled Drizzle client for `connectionString`.
 *
 * The caller owns the handle and must `close()` it — an open pool keeps the
 * event loop alive, which is the difference between a test run that exits and
 * one that hangs.
 */
export function createDatabase(
  connectionString: string,
  poolOptions: Omit<PoolConfig, 'connectionString'> = {},
): DatabaseHandle {
  const pool = new Pool({ ...poolOptions, connectionString });

  const db = drizzle(pool, {
    schema,
    // Must match `casing` in drizzle.config.ts: it is what turns a camelCase
    // TypeScript field into the snake_case column the generated migration
    // creates. Set in both places because the two paths never read one config —
    // drizzle-kit generates SQL, this client builds queries at runtime, and a
    // mismatch would only surface as a "column does not exist" at query time.
    casing: 'snake_case',
  });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
