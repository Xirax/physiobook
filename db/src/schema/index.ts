/**
 * Barrel for the data model — the single place every consumer imports tables
 * from (PROJECT_STRUCTURE.md §5). Backend services and the test harness import
 * from here; no table is ever redefined outside this directory.
 *
 * It is also what drizzle.config.ts points `schema` at, so a table that is not
 * re-exported here does not exist as far as `db:generate` is concerned.
 *
 * Empty at ticket 0.4 by design: the first tables (`users`) land in 1.1, and
 * the extensions the schema depends on are created by docker/postgres/init.sql,
 * never by a migration.
 */
export {};
