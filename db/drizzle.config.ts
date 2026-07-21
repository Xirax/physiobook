import { defineConfig } from 'drizzle-kit';

import { loadRootEnv } from './src/env.js';

/**
 * Drizzle Kit config — `db:generate` (diff the schema into SQL) and the
 * database-touching commands (`check`, `studio`).
 *
 * `push` is not used in this project and never will be: it mutates a database
 * without leaving a migration behind, so the schema in git would stop
 * describing what is actually deployed.
 */

loadRootEnv();

export default defineConfig({
  dialect: 'postgresql',

  // The barrel, not a glob: a table that is not re-exported from it is not part
  // of the model, and `generate` should agree with that.
  schema: './src/schema/index.ts',
  out: './migrations',

  // camelCase in TypeScript, snake_case in Postgres (SCHEMA.md), applied
  // automatically instead of a hand-written column name on every field. The
  // runtime client in src/client.ts sets the same option — see the note there.
  casing: 'snake_case',

  // Only the commands that connect need this. `generate` is offline, so a
  // missing DATABASE_URL must not throw here: it would break schema generation
  // on a machine that has no database at all. The empty string turns "not
  // configured" into an error from the command that actually needs a database.
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
});
