import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { createDatabase } from './client.js';
import { requireDatabaseUrl } from './env.js';

/**
 * Dev/demo seed data (`pnpm db:seed`).
 *
 * A stub at ticket 0.4 — there are no tables yet — but a *runnable* one: it
 * opens a real connection and closes it cleanly, so the plumbing is proven now
 * rather than debugged later on top of half-written fixtures. It grows one
 * block per ticket that introduces a table.
 *
 * Seeds are for development and demos only. Nothing in the test suite may
 * depend on them: tests build the exact rows they assert on, or they are
 * describing someone else's data.
 */
export async function seed(connectionString: string): Promise<void> {
  const { db, close } = createDatabase(connectionString, { max: 1 });

  try {
    // Placeholder round-trip: proves the URL resolves to a database that
    // answers queries. Replaced by the first real insert in 1.1.
    await db.execute(sql`select 1`);
  } finally {
    await close();
  }
}

// CLI entrypoint. Guarded so importing `seed` (a future test fixture, a script)
// does not write to whatever DATABASE_URL points at.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = requireDatabaseUrl();
  await seed(url);
  console.log('Seed complete (nothing to insert yet — the first tables land in 1.1).');
}
