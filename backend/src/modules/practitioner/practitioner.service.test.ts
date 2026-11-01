import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

import { findPractitionerId } from './practitioner.service.js';

describe('findPractitionerId', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database?.drop();
  });

  it('Returns the seeded admin as the practitioner', async () => {
    const { rows } = await database.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin'`,
    );

    await expect(findPractitionerId(database.db)).resolves.toBe(rows[0]!.id);
  });

  it('Fails loudly when there is no admin user', async () => {
    await database.pool.query(`UPDATE users SET role = 'user'`);

    await expect(findPractitionerId(database.db)).rejects.toThrow(
      'the practitioner (admin) user is missing',
    );
  });
});
