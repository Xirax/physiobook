import { users } from '@physiobook/db';
import bcrypt from 'bcrypt';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

describe('Users table', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  const insertUser = (email: string) =>
    database.pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'not-a-real-hash', 'Test User')`,
      [email],
    );

  it('Seeds exactly one admin, with the documented address', async () => {
    const admins = await database.db.select().from(users).where(eq(users.role, 'admin'));

    expect(admins).toHaveLength(1);
    expect(admins[0]?.email).toBe('admin@physiobook.local');
    expect(admins[0]?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('Seeds the admin with a hash of the password its migration documents', async () => {
    const [admin] = await database.db.select().from(users).where(eq(users.role, 'admin'));

    expect(admin).toBeDefined();
    await expect(bcrypt.compare('ChangeMe123!', admin!.passwordHash)).resolves.toBe(true);
    expect(admin!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('Rejects a second admin', async () => {
    await expect(
      database.pool.query(
        `INSERT INTO users (email, password_hash, role, full_name)
         VALUES ('second.admin@physiobook.local', 'not-a-real-hash', 'admin', 'Impostor')`,
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint "users_single_admin_idx"/);
  });

  it('Still allows any number of ordinary users', async () => {
    const emails = ['patient.one@example.com', 'patient.two@example.com'];

    await insertUser(emails[0]!);
    await insertUser(emails[1]!);

    const count = await database.db.$count(users, inArray(users.email, emails));
    expect(count).toBe(2);
  });

  it('Treats emails differing only in case as the same account', async () => {
    await insertUser('Alex@x.com');

    await expect(insertUser('alex@x.com')).rejects.toThrow(
      /duplicate key value violates unique constraint "users_email_unique"/,
    );
  });

  it('Finds a user by an address cased differently from the stored one', async () => {
    await insertUser('Casey.Jones@example.com');

    const found = await database.db
      .select()
      .from(users)
      .where(eq(users.email, 'casey.jones@EXAMPLE.com'));

    expect(found).toHaveLength(1);
    expect(found[0]?.email).toBe('Casey.Jones@example.com');
  });

  it('Moves updated_at on update, and leaves created_at alone', async () => {
    await insertUser('renamed@example.com');

    const before = await database.db
      .select()
      .from(users)
      .where(eq(users.email, 'renamed@example.com'));
    const original = before[0];
    expect(original).toBeDefined();

    await database.db
      .update(users)
      .set({ updatedAt: sql`now() - interval '1 hour'` })
      .where(eq(users.email, 'renamed@example.com'));

    await database.db
      .update(users)
      .set({ fullName: 'Renamed User' })
      .where(eq(users.email, 'renamed@example.com'));

    const after = await database.db
      .select()
      .from(users)
      .where(eq(users.email, 'renamed@example.com'));
    const updated = after[0];
    expect(updated).toBeDefined();

    expect(updated?.fullName).toBe('Renamed User');
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(original!.updatedAt.getTime());
    expect(updated?.createdAt.getTime()).toBe(original!.createdAt.getTime());
  });

  it('Overrides an updated_at the caller tried to set by hand', async () => {
    await insertUser('liar@example.com');

    await database.db
      .update(users)
      .set({ fullName: 'Sneaky', updatedAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(users.email, 'liar@example.com'));

    const after = await database.db.select().from(users).where(eq(users.email, 'liar@example.com'));

    expect(after[0]?.updatedAt.getFullYear()).toBeGreaterThan(2000);
  });
});
