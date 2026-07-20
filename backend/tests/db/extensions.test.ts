import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestPostgres } from '../helpers/test-db.js';

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Integration test against a real Postgres (ticket 0.3).
 *
 * Its job in the 0.3 skeleton is to prove the CI pipeline can provision a
 * database via Testcontainers at all — if this passes on a runner, every later
 * race/overlap/constraint test has a working foundation.
 *
 * What it asserts is not filler, though: `btree_gist` is the hard prerequisite
 * for the anti-double-booking EXCLUDE constraint (CLAUDE.md §4). If
 * docker/postgres/init.sql ever stops being applied to test databases, the
 * booking tests would fail much later with a confusing "data type uuid has no
 * default operator class" — this fails first, and says why.
 */
describe('test database', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await startTestPostgres();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    // Pulling postgres:18-alpine on a cold runner dominates this; the query
    // itself is instant.
  }, 180_000);

  afterAll(async () => {
    // Guarded because a failure in beforeAll (image pull timeout, no Docker
    // daemon) leaves these undefined, and an unguarded teardown would replace
    // the real error with a TypeError.
    await client?.end();
    await container?.stop();
  });

  it.each(['btree_gist', 'citext'])('has the %s extension installed', async (extension) => {
    const result = await client.query<{ extname: string }>(
      'SELECT extname FROM pg_extension WHERE extname = $1',
      [extension],
    );

    expect(result.rows.map((row) => row.extname)).toEqual([extension]);
  });

  it('can create an EXCLUDE constraint over a tstzrange', async () => {
    // The actual capability btree_gist is installed for: a GiST index mixing a
    // scalar (practitioner_id) with a range. `CREATE EXTENSION` succeeding does
    // not by itself prove the operator classes are usable, so exercise it.
    await client.query(`
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

    await client.query(insertProbe, probeValues);

    await expect(client.query(insertProbe, probeValues)).rejects.toThrow(
      /conflicting key value violates exclusion constraint/,
    );
  });
});
