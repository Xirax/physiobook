import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@physiobook/db';
import { Client } from 'pg';

import { withDatabase } from './postgres-uri.js';

import type { TestProject } from 'vitest/node';

/**
 * Boots the one Postgres the whole test run shares (ticket 0.4).
 *
 * Vitest runs this once per run, before any test file, and tears it down after
 * the last one — which is the only place a *single* container can live, because
 * test files run in separate workers and share no module state.
 *
 * What it leaves behind is a **template database**: `docker/postgres/init.sql`
 * applied, every migration applied, and nothing else. Each test file then
 * clones it (see test-db.ts) in well under a second, so per-file isolation
 * costs a `CREATE DATABASE` instead of a container boot and a migration run.
 *
 * This is the only way a test gets a database, locally and in CI alike — there
 * is no separate CI service-container path to drift out of sync
 * (PROJECT_STRUCTURE.md §9). If it runs on your machine it runs on the runner,
 * because it is the same code talking to the same Docker daemon.
 */

/**
 * Must match the `postgres` service image in docker-compose.yml.
 *
 * Pinned to the same major version deliberately: the EXCLUDE-constraint
 * behaviour these tests exist to prove is a database behaviour, so testing it
 * on a different Postgres than production runs would prove nothing about
 * production.
 */
const POSTGRES_IMAGE = 'postgres:18-alpine';

/**
 * The single enabler of extensions, shared with the compose Postgres. Resolved
 * relative to this file rather than the working directory so it does not matter
 * whether Vitest was launched from the repo root or from `backend/`.
 */
const INIT_SQL_PATH = fileURLToPath(new URL('../../../docker/postgres/init.sql', import.meta.url));

/** Cloned per test file; never written to by a test. */
const TEMPLATE_DATABASE = 'physiobook_template';

declare module 'vitest' {
  interface ProvidedContext {
    /**
     * How a test file reaches the container this file started. Values must stay
     * structured-cloneable — they cross a worker boundary.
     */
    postgres: {
      /** Connection URI for the container's default database, as the superuser. */
      adminUri: string;
      /** Name of the migrated database each test file clones. */
      templateDatabase: string;
    };
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // No init script is mounted into /docker-entrypoint-initdb.d, on purpose: the
  // image would run it against the container's *default* database, which no
  // test ever touches once every test works on a clone. Applying init.sql to
  // the template below is what actually puts btree_gist in the databases tests
  // get — and it is the same file the compose Postgres loads, which is the
  // property that matters (PROJECT_STRUCTURE.md §5).
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const adminUri = container.getConnectionUri();

  try {
    const admin = new Client({ connectionString: adminUri });
    await admin.connect();
    try {
      // Identifier, so it cannot be a bound parameter. The value is the
      // file-local constant above, not input.
      await admin.query(`CREATE DATABASE "${TEMPLATE_DATABASE}"`);
    } finally {
      // Nothing may hold a connection to a database Postgres is asked to use as
      // a TEMPLATE, and this client's is to the default database — but the
      // template's own connection below is closed for exactly that reason.
      await admin.end();
    }

    const templateUri = withDatabase(adminUri, TEMPLATE_DATABASE);

    const template = new Client({ connectionString: templateUri });
    await template.connect();
    try {
      await template.query(await readFile(INIT_SQL_PATH, 'utf8'));
    } finally {
      await template.end();
    }

    // The same runner `pnpm db:migrate` uses — a test database built by a
    // different code path than production would stop proving anything about
    // production the first time the two drifted. A no-op while there are zero
    // migrations (the first one, `users`, lands in 1.1).
    await runMigrations(templateUri);
  } catch (error) {
    // Otherwise a failure here leaks the container for the rest of the session:
    // the teardown below is only registered by returning it.
    await container.stop();
    throw error;
  }

  project.provide('postgres', { adminUri, templateDatabase: TEMPLATE_DATABASE });

  return async () => {
    await container.stop();
  };
}
