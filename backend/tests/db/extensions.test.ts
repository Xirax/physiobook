import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

/**
 * Integration test against a real Postgres.
 *
 * `btree_gist` is the hard prerequisite for the anti-double-booking EXCLUDE
 * constraint (CLAUDE.md §4). It reaches a test database only if the harness
 * applies docker/postgres/init.sql to the template every test clones — and if
 * it ever stops doing that, the booking tests would fail much later with a
 * confusing "data type uuid has no default operator class". This fails first,
 * and says why.
 *
 * It asserts against the *clone*, not the container's default database, because
 * the clone is what every other test actually runs on.
 */
describe('test database extensions', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    // Guarded: if the clone failed to appear, an unguarded teardown would
    // replace the real error with a TypeError.
    await database?.drop();
  });

  it.each(['btree_gist', 'citext'])('has the %s extension installed', async (extension) => {
    const result = await database.pool.query<{ extname: string }>(
      'SELECT extname FROM pg_extension WHERE extname = $1',
      [extension],
    );

    expect(result.rows.map((row) => row.extname)).toEqual([extension]);
  });

  it('can create an EXCLUDE constraint over a tstzrange', async () => {
    // The actual capability btree_gist is installed for: a GiST index mixing a
    // scalar (practitioner_id) with a range. `CREATE EXTENSION` succeeding does
    // not by itself prove the operator classes are usable, so exercise it.
    await database.pool.query(`
      CREATE TABLE exclusion_probe (
        practitioner_id uuid NOT NULL,
        during tstzrange NOT NULL,
        EXCLUDE USING gist (practitioner_id WITH =, during WITH &&)
      )
    `);

    // Parameterised rather than interpolated. Both values are file-local
    // constants, so nothing is exploitable here — but every later race and
    // overlap test starts life as a copy of this file, and a template that
    // mixes `query(text, values)` with string building teaches the wrong habit
    // to the tests that will handle real appointment data.
    const insertProbe = `
      INSERT INTO exclusion_probe (practitioner_id, during)
      VALUES ($1, tstzrange($2, $3))
    `;
    const probeValues = [
      '00000000-0000-0000-0000-000000000001',
      '2026-01-01T09:00:00Z',
      '2026-01-01T10:00:00Z',
    ];

    await database.pool.query(insertProbe, probeValues);

    await expect(database.pool.query(insertProbe, probeValues)).rejects.toThrow(
      /conflicting key value violates exclusion constraint/,
    );
  });
});
