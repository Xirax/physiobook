import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { EmailTakenError } from '../../lib/errors.js';
import { registerUser } from './auth.service.js';

describe('RegisterUser, when the database itself fails', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.pool.query('DROP TABLE users CASCADE');
  });

  afterAll(async () => {
    await database?.drop();
  });

  const register = () =>
    registerUser(
      { email: 'ada@example.com', password: 'correct-horse-battery', full_name: 'Ada Lovelace' },
      {
        db: database.db,
        jwtSecret: 'a-test-secret-long-enough-for-hs256',
        jwtTtlSeconds: 900,
        refreshTtlSeconds: 604_800,
      },
    );

  it('Does not mistake an unrelated failure for a taken email', async () => {
    await expect(register()).rejects.not.toBeInstanceOf(EmailTakenError);
  });

  it('Propagates the driver error, which names the real problem', async () => {
    await expect(register()).rejects.toMatchObject({
      code: '42P01',
    });
  });

  it('Does not carry the password hash on the error it throws', async () => {
    const error = await register().catch((caught: unknown) => caught);

    expect(String((error as Error).message)).not.toMatch(/\$2[aby]\$/);
    expect(String((error as Error).message)).not.toContain('correct-horse-battery');
  });
});
