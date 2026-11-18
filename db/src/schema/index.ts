/**
 * Barrel for the data model — the single place every consumer imports tables
 * from (PROJECT_STRUCTURE.md §5). Backend services and the test harness import
 * from here; no table is ever redefined outside this directory.
 *
 * It is also what drizzle.config.ts points `schema` at, so a table that is not
 * re-exported here does not exist as far as `db:generate` is concerned.
 *
 * The extensions the schema depends on (`citext` for users.email, `btree_gist`
 * for the ledger's EXCLUDE constraint) are created by docker/postgres/init.sql,
 * never by a migration.
 */
export * from './users.js';
export * from './sessions.js';
export * from './practice-settings.js';
export * from './business-hours.js';
export * from './calendar-blocks.js';
export * from './notification-log.js';
