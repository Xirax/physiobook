import { defineConfig } from 'vitest/config';

/**
 * Workspace-level Vitest config (ticket 0.3).
 *
 * Every package's suite runs through this one entrypoint as a Vitest *project*
 * rather than via `pnpm -r test`. The reason is coverage: `-r` would produce a
 * separate, unmergeable report per package, and the coverage gate (§9 of
 * PROJECT_STRUCTURE.md) needs a single number for the whole repo. Each project
 * still keeps its own config file next to the code it tests, so package
 * boundaries are intact — this file only composes them.
 *
 * Projects are added as their packages grow tests: frontend joins with React
 * Testing Library in E2, shared/db when they hold real code. Listing an empty
 * package here today would only buy a permanently-passing no-op suite.
 */

/**
 * Placeholder coverage gate.
 *
 * The mechanism ships now so it cannot be "added later" and quietly never be;
 * the real number is set in ticket 7.4 once there is a suite worth measuring.
 * Until then the threshold defaults to 0 — the empty scaffold stays green
 * without anyone disabling the gate, which is the failure mode this default is
 * chosen to avoid.
 *
 * Override per-run without touching this file:
 *   COVERAGE_THRESHOLD=80 pnpm test:coverage
 * CI sets it from a single `env:` key in .github/workflows/ci.yml.
 */
const coverageThreshold = Number(process.env['COVERAGE_THRESHOLD'] ?? 0);

if (!Number.isFinite(coverageThreshold) || coverageThreshold < 0 || coverageThreshold > 100) {
  throw new Error(
    `COVERAGE_THRESHOLD must be a number between 0 and 100, got: ${String(process.env['COVERAGE_THRESHOLD'])}`,
  );
}

export default defineConfig({
  test: {
    projects: ['backend'],

    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',

      // `text` prints to the step log, `json-summary` is what the CI job
      // summary parses, `lcov` is the machine-readable artifact (and what a
      // coverage service would ingest later), `html` is the browsable report a
      // human opens after downloading the artifact.
      reporter: ['text', 'json-summary', 'lcov', 'html'],

      // Report on every source file, not just the ones a test happened to
      // import. Without this an untested module is invisible rather than a 0%
      // row, which would let coverage look healthy precisely where it is not.
      all: true,
      include: ['backend/src/**/*.ts'],
      exclude: [
        // Boots the server and listens; it is exercised by the docker smoke
        // workflow and, from E7, by Playwright — never by a unit test.
        'backend/src/index.ts',
      ],

      thresholds: {
        lines: coverageThreshold,
        functions: coverageThreshold,
        branches: coverageThreshold,
        statements: coverageThreshold,
      },
    },
  },
});
