import { existsSync } from 'node:fs';

/**
 * Environment loading for the `db` package's command-line entrypoints
 * (`db:generate`, `db:migrate`, `db:seed`) — and nothing else.
 *
 * The library code in this package never reads env: `createDatabase()` and
 * `runMigrations()` take a connection string as an argument, so the test
 * harness can point them at a throwaway container without a `.env` existing at
 * all. Only the scripts a human runs resolve a URL from the environment.
 */

/**
 * The repo root `.env`, relative to the working directory.
 *
 * Every consumer is an npm script in this package (`pnpm --filter
 * @physiobook/db db:migrate`, or the root passthroughs), and pnpm runs a
 * package's scripts with that package's directory as the cwd — so `../.env` is
 * always the repo root's. Deliberately not resolved from `import.meta.url`:
 * drizzle-kit bundles drizzle.config.ts (and everything it imports) into a
 * temporary file before executing it, which moves that URL somewhere unrelated.
 */
const ROOT_ENV_FILE = '../.env';

/**
 * Loads the repo root `.env` into `process.env`, if there is one.
 *
 * Absence is not an error: CI and the docker services set their variables
 * directly, and `drizzle-kit generate` needs no database at all. Variables
 * already present in the real environment win — the file only fills gaps.
 */
export function loadRootEnv(): void {
  if (process.env['DATABASE_URL'] !== undefined) return;
  if (!existsSync(ROOT_ENV_FILE)) return;

  process.loadEnvFile(ROOT_ENV_FILE);
}

/**
 * The connection string for the commands that actually talk to a database.
 *
 * Fails loudly rather than falling back to a default: a silent default here
 * would mean a migration running against a database nobody named.
 */
export function requireDatabaseUrl(): string {
  loadRootEnv();

  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env at the repo root, or export it ' +
        'for this command.',
    );
  }

  return url;
}

/**
 * The password hash for the default admin, for `db:migrate` to hand to the
 * `users` data migration.
 *
 * Optional, and deliberately not defaulted here: the fallback is the
 * development hash committed in the migration itself, so the "unset" case has
 * to stay distinguishable all the way to the caller that warns about it.
 *
 * An empty value is treated as unset — an exported-but-blank variable is a
 * misconfiguration, and inserting an empty hash would create an admin no
 * password can ever match.
 */
export function optionalAdminPasswordHash(): string | undefined {
  loadRootEnv();

  const hash = process.env['ADMIN_PASSWORD_HASH'];
  return hash === undefined || hash === '' ? undefined : hash;
}
