import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '@physiobook/db';
import { Client } from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { withDatabase } from '../helpers/postgres-uri.js';

/**
 * How the default admin's password hash is chosen on a first migrate.
 *
 * These tests build their own databases instead of using the shared harness:
 * `createTestDatabase()` clones a template that is *already* migrated and
 * already holds an admin, so it cannot answer what the first apply inserts —
 * which is the only moment this decision is made.
 *
 * Worth the extra databases because the failure being guarded against is
 * silent. If the run-time parameter never reached the migration, every
 * deployment would get the public development hash while appearing configured.
 */

const INIT_SQL_PATH = fileURLToPath(new URL('../../../docker/postgres/init.sql', import.meta.url));

describe('default admin password hash', () => {
  const created: string[] = [];

  afterAll(async () => {
    const { adminUri } = inject('postgres');

    const admin = new Client({ connectionString: adminUri });
    await admin.connect();
    try {
      for (const name of created) {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
    }
  });

  /** A database at the state global-setup starts from: extensions, no migrations. */
  async function freshDatabase(): Promise<string> {
    const { adminUri } = inject('postgres');
    // Interpolated because a database name is an identifier and cannot be
    // bound; the value is generated here, never input.
    const name = `admin_seed_${randomUUID().replaceAll('-', '')}`;

    const admin = new Client({ connectionString: adminUri });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      created.push(name);
    } finally {
      await admin.end();
    }

    const uri = withDatabase(adminUri, name);
    const client = new Client({ connectionString: uri });
    await client.connect();
    try {
      // citext, without which the users migration cannot create its email column.
      await client.query(await readFile(INIT_SQL_PATH, 'utf8'));
    } finally {
      await client.end();
    }

    return uri;
  }

  async function readAdminHash(uri: string): Promise<string | undefined> {
    const client = new Client({ connectionString: uri });
    await client.connect();
    try {
      const result = await client.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE role = 'admin'`,
      );
      return result.rows[0]?.password_hash;
    } finally {
      await client.end();
    }
  }

  it('uses the hash the caller supplies', async () => {
    // Not a real bcrypt hash — the column is text and the migration does not
    // parse it. A sentinel makes a failure say which branch was taken.
    const supplied = '$2b$12$SUPPLIED-BY-THE-CALLER-NOT-THE-COMMITTED-FALLBACK';
    const uri = await freshDatabase();

    await runMigrations(uri, { adminPasswordHash: supplied });

    expect(await readAdminHash(uri)).toBe(supplied);
  });

  it('falls back to the committed development hash when none is supplied', async () => {
    const uri = await freshDatabase();

    await runMigrations(uri);

    // Asserts the shape, not the literal: rotating the committed default is a
    // thing someone should be able to do without editing this test.
    expect(await readAdminHash(uri)).toMatch(/^\$2[aby]\$/);
  });

  it('treats an empty hash as unset rather than storing it', async () => {
    // An exported-but-blank ADMIN_PASSWORD_HASH is a misconfiguration. Storing
    // it would create an admin that no password can ever authenticate as, and
    // ON CONFLICT DO NOTHING means no later migrate would repair the row.
    const uri = await freshDatabase();

    await runMigrations(uri, { adminPasswordHash: '' });

    expect(await readAdminHash(uri)).toMatch(/^\$2[aby]\$/);
  });
});
