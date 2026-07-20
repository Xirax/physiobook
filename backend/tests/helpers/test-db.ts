import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Testcontainers Postgres harness (ticket 0.3).
 *
 * This is the *only* way a test gets a database, locally and in CI alike —
 * there is no separate CI service-container path to drift out of sync
 * (PROJECT_STRUCTURE.md §9). If it runs on your machine it runs on the runner,
 * because it is the same code talking to the same Docker daemon.
 *
 * Ticket 0.3 gets the container and the extensions. The template-database
 * clone-per-test flow described in PROJECT_STRUCTURE.md §4 lands with the first
 * migration — there is nothing to migrate yet, and building that machinery
 * against an empty schema would be guessing at its shape.
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

/**
 * Boots a throwaway Postgres with `docker/postgres/init.sql` applied.
 *
 * The image is pulled on first use, which can take a while on a cold runner —
 * callers should pass a generous timeout to `beforeAll`.
 */
export async function startTestPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCopyFilesToContainer([
      {
        source: INIT_SQL_PATH,
        // Everything in this directory is executed by the official image on
        // first boot of an empty data directory — which a fresh container
        // always is. This is what keeps CREATE EXTENSION out of migrations.
        target: '/docker-entrypoint-initdb.d/init.sql',
      },
    ])
    .start();
}
