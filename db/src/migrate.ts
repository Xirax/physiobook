import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';
import { optionalAdminPasswordHash, requireDatabaseUrl } from './env.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

const ADMIN_PASSWORD_HASH_SETTING = 'physiobook.admin_password_hash';

export interface MigrationOptions {
  adminPasswordHash?: string | undefined;
}

export async function runMigrations(
  connectionString: string,
  options: MigrationOptions = {},
): Promise<void> {
  const { db, close } = createDatabase(connectionString, { max: 1 });

  try {
    const { adminPasswordHash } = options;
    if (adminPasswordHash !== undefined && adminPasswordHash !== '') {
      await db.execute(
        sql`SELECT set_config(${ADMIN_PASSWORD_HASH_SETTING}, ${adminPasswordHash}, false)`,
      );
    }

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = requireDatabaseUrl();
  const adminPasswordHash = optionalAdminPasswordHash();

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
