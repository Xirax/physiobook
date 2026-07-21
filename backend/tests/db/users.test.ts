import { users } from '@physiobook/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

/**
 * The `users` table's database-level invariants (ticket E1.1).
 *
 * Every property asserted here is enforced by Postgres, not by a service — so
 * these tests run against a real database (CLAUDE.md §5.2) and would be
 * meaningless against a mock. They are what stops a later refactor from
 * "simplifying" the citext column, the partial index or the trigger away.
 *
 * The clone each test file gets already has the seeded admin in it: it arrives
 * with the migrations, not with `db:seed`.
 */
describe('users table', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  /** Inserts a `user`-role row; every field the table demands, nothing more. */
  const insertUser = (email: string) =>
    database.pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'not-a-real-hash', 'Test User')`,
      [email],
    );

  it('seeds exactly one admin, with the documented address', async () => {
    const admins = await database.db.select().from(users).where(eq(users.role, 'admin'));

    expect(admins).toHaveLength(1);
    expect(admins[0]?.email).toBe('admin@physiobook.local');
    // The data migration must not leave a plaintext password behind, whatever
    // else it does.
    expect(admins[0]?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects a second admin', async () => {
    // The single-admin invariant (SCHEMA.md §2.1) as a partial unique index, so
    // two concurrent inserts cannot both pass a check the way they could if a
    // service counted the admins first.
    await expect(
      database.pool.query(
        `INSERT INTO users (email, password_hash, role, full_name)
         VALUES ('second.admin@physiobook.local', 'not-a-real-hash', 'admin', 'Impostor')`,
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint "users_single_admin_idx"/);
  });

  it('still allows any number of ordinary users', async () => {
    // The other half of "partial": the index must constrain admins only, or the
    // app would have exactly one patient.
    const emails = ['patient.one@example.com', 'patient.two@example.com'];

    await insertUser(emails[0]!);
    await insertUser(emails[1]!);

    // Scoped to the two addresses this test inserted, not `role = 'user'`.
    // Counting every user row would pass only while no test above happens to
    // insert one, making a later addition to this file fail here for a reason
    // unrelated to the property under test.
    const count = await database.db.$count(users, inArray(users.email, emails));
    expect(count).toBe(2);
  });

  it('treats emails differing only in case as the same account', async () => {
    // citext, not `lower(email)` in application code: the guarantee has to hold
    // for a writer that forgot to normalise.
    await insertUser('Alex@x.com');

    await expect(insertUser('alex@x.com')).rejects.toThrow(
      /duplicate key value violates unique constraint "users_email_unique"/,
    );
  });

  it('finds a user by an address cased differently from the stored one', async () => {
    // The read side of the same property — a login lookup must not depend on
    // the capitalisation the user typed at registration.
    await insertUser('Casey.Jones@example.com');

    const found = await database.db
      .select()
      .from(users)
      .where(eq(users.email, 'casey.jones@EXAMPLE.com'));

    expect(found).toHaveLength(1);
    expect(found[0]?.email).toBe('Casey.Jones@example.com');
  });

  it('moves updated_at on update, and leaves created_at alone', async () => {
    await insertUser('renamed@example.com');

    const before = await database.db
      .select()
      .from(users)
      .where(eq(users.email, 'renamed@example.com'));
    const original = before[0];
    expect(original).toBeDefined();

    // The trigger stamps `now()`, which is the *transaction* timestamp and so is
    // identical for two statements in one transaction — and can be identical
    // across two back-to-back autocommit statements on a clock with coarse
    // resolution. Backdating the row is deterministic where a sleep would be
    // flaky.
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
    // A trigger that overwrote created_at would make the audit trail lie.
    expect(updated?.createdAt.getTime()).toBe(original!.createdAt.getTime());
  });

  it('overrides an updated_at the caller tried to set by hand', async () => {
    // BEFORE UPDATE, so the trigger has the last word. Without this the column
    // is only a convention, and any writer can make a row look untouched.
    await insertUser('liar@example.com');

    await database.db
      .update(users)
      .set({ fullName: 'Sneaky', updatedAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(users.email, 'liar@example.com'));

    const after = await database.db.select().from(users).where(eq(users.email, 'liar@example.com'));

    expect(after[0]?.updatedAt.getFullYear()).toBeGreaterThan(2000);
  });
});
