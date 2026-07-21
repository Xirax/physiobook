/**
 * Public surface of the `db` package (PROJECT_STRUCTURE.md §5).
 *
 * Backend code and the Testcontainers harness import the data model and the
 * Drizzle client from here — one source of truth, no table defined twice.
 *
 * `seed.ts` is intentionally absent: it is a dev/demo script, not part of the
 * contract other packages build on.
 */
export * from './schema/index.js';
export { createDatabase, type Database, type DatabaseHandle } from './client.js';
export { runMigrations, MIGRATIONS_DIR } from './migrate.js';
