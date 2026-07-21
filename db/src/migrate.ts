import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';
import { requireDatabaseUrl } from './env.js';

/**
 * The migration runner — one implementation, two callers.
 *
 * `pnpm db:migrate` runs it against DATABASE_URL, and the Testcontainers
 * harness (backend/tests/helpers/global-setup.ts) runs it against the template
 * database it hands to tests. Deliberately the same function: a test database
 * built by a different code path than production would stop proving anything
 * about production the first time the two drifted.
 */

/**
 * Where drizzle-kit writes generated SQL, resolved relative to this file so the
 * caller's working directory does not matter — the harness invokes this from
 * `backend/`, the npm script from `db/`.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies every pending migration, then closes its connection. A no-op against
 * an up-to-date database.
 *
 * Migrations create tables, constraints and the rows an install cannot function
 * without (the admin user); extensions are created by docker/postgres/init.sql,
 * never here.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  // A single connection: migrations are strictly sequential, and a pool would
  // only add idle sockets to keep track of.
  const { db, close } = createDatabase(connectionString, { max: 1 });

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await close();
  }
}

// CLI entrypoint (`pnpm db:migrate`). The guard keeps importing this module
// free of side effects — the test harness imports `runMigrations` and must not
// trigger a run against whatever DATABASE_URL happens to be set.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = requireDatabaseUrl();
  await runMigrations(url);
  console.log(`Migrations applied from ${MIGRATIONS_DIR}`);
}
