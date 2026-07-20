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

    // Booting a Postgres container is far slower than any unit test. The
    // default 5s would fail an integration test purely on image pull time on a
    // cold CI runner; the container helpers set their own longer hook timeout.
    testTimeout: 30_000,
  },
});
