import { defineConfig } from 'vitest/config';

/**
 * Backend test project (ticket 0.3).
 *
 * Coverage, reporters and the gate live in the root vitest.config.ts — this
 * file only says what to run and how. Run the whole workspace from the root
 * (`pnpm test`); running `vitest` here directly works too and is the fast loop
 * while writing backend code.
 */
export default defineConfig({
  test: {
    name: 'backend',
    environment: 'node',

    // Unit/route tests sit next to the code (`src/**/*.test.ts`); DB-backed and
    // race tests live under `tests/` because they need the Testcontainers
    // harness. See PROJECT_STRUCTURE.md §4.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],

    // Boots the one Postgres the run shares and leaves a migrated template
    // behind; test files clone it through tests/helpers/test-db.ts. Runs once
    // per run, before any test file — the only place a single container can
    // live, since test files run in separate workers and share no module state.
    //
    // It starts unconditionally, so every backend run needs Docker, including
    // one that only touches unit tests. That is the deliberate trade: the
    // alternative — booting lazily on first use — puts the image pull inside
    // whichever test happened to ask first and makes its timeout everyone's
    // problem.
    globalSetup: ['tests/helpers/global-setup.ts'],

    // Cloning a template database is milliseconds; the default 5s is plenty for
    // the tests themselves. The slow parts — pulling postgres:18-alpine on a
    // cold runner, migrating the template — are in globalSetup, which Vitest
    // does not apply this to.
    testTimeout: 30_000,

    // Stopping the container is a Docker round-trip, and a teardown killed
    // half-way leaks it for the rest of the session.
    teardownTimeout: 60_000,
  },
});
