import { defineConfig } from 'drizzle-kit';

import { loadRootEnv, requireDatabaseUrl } from './src/env.js';

/**
 * Drizzle Kit config — `db:generate` (diff the schema into SQL) and the
 * database-touching commands (`check`, `studio`).
 *
 * `push` is not used in this project and never will be: it mutates a database
 * without leaving a migration behind, so the schema in git would stop
 * describing what is actually deployed.
 */

loadRootEnv();

/**
 * The drizzle-kit subcommands that open a connection. `generate` is absent on
 * purpose — it diffs the schema offline and must keep working on a machine with
 * no database at all.
 */
const DATABASE_COMMANDS = new Set(['push', 'pull', 'studio', 'migrate']);

/**
 * drizzle-kit evaluates this config in its own process, so argv[2] is the
 * subcommand being run. Read only to decide *when* to demand a URL, and
 * deliberately permissive when it does not match: an unrecognised argv falls
 * back to the old behaviour (a driver-level error from the command itself)
 * rather than refusing to run a command that never needed a database.
 */
const needsDatabase = DATABASE_COMMANDS.has(process.argv[2] ?? '');

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

  // Demanded only by the commands that connect, so an unconfigured machine can
  // still run `generate` — and so the ones that do connect fail with the reason
  // ("DATABASE_URL is not set, copy .env.example") instead of the driver's
  // parse error on an empty string.
  dbCredentials: {
    url: needsDatabase ? requireDatabaseUrl() : (process.env['DATABASE_URL'] ?? ''),
  },
});
