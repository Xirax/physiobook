import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';
import { optionalAdminPasswordHash, requireDatabaseUrl } from './env.js';

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
 * The Postgres run-time parameter the `users` data migration reads its admin
 * password hash from, falling back to a development default when it is unset.
 *
 * A custom (dotted) parameter name, which Postgres accepts and ignores, is the
 * only channel a plain `.sql` file has for a value the caller decides: the
 * migrator executes files verbatim and cannot bind parameters into them.
 */
const ADMIN_PASSWORD_HASH_SETTING = 'physiobook.admin_password_hash';

export interface MigrationOptions {
  /**
   * bcrypt/argon2 hash for the default admin created by the `users` data
   * migration. Omitted or empty leaves the development default committed in
   * that migration, which is public — every real deployment sets this.
   *
   * Only read on the *first* apply: the insert is `ON CONFLICT DO NOTHING`, so
   * passing it to a database that already has an admin changes nothing.
   */
  adminPasswordHash?: string | undefined;
}

/**
 * Applies every pending migration, then closes its connection. A no-op against
 * an up-to-date database.
 *
 * Migrations create tables, constraints and the rows an install cannot function
 * without (the admin user); extensions are created by docker/postgres/init.sql,
 * never here.
 */
export async function runMigrations(
  connectionString: string,
  options: MigrationOptions = {},
): Promise<void> {
  // A single connection: migrations are strictly sequential, and a pool would
  // only add idle sockets to keep track of.
  //
  // `max: 1` is also what makes the setting below reach the migration. A
  // run-time parameter is session state, so it lives on one connection — with a
  // larger pool `migrate()` could take a different one and silently see the
  // default instead.
  const { db, close } = createDatabase(connectionString, { max: 1 });

  try {
    const { adminPasswordHash } = options;
    if (adminPasswordHash !== undefined && adminPasswordHash !== '') {
      // Bound, not interpolated: a hash is caller-supplied data reaching a
      // session that is about to run DDL.
      await db.execute(
        sql`SELECT set_config(${ADMIN_PASSWORD_HASH_SETTING}, ${adminPasswordHash}, false)`,
      );
    }

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
  const adminPasswordHash = optionalAdminPasswordHash();

  // Loud on the path that leaves a publicly-known credential in place. It is
  // only reachable on a database with no admin yet, so a developer sees it once
  // and a first production deploy sees it exactly when it matters.
  if (adminPasswordHash === undefined) {
    console.warn(
      'WARNING: ADMIN_PASSWORD_HASH is not set. If this database has no admin yet, it will be ' +
        'created with the development password committed in ' +
        '0001_users_updated_at_and_admin.sql, which is public. Set ADMIN_PASSWORD_HASH before ' +
        'migrating anything that is not a throwaway database.',
    );
  }

  await runMigrations(url, { adminPasswordHash });
  console.log(`Migrations applied from ${MIGRATIONS_DIR}`);
}
