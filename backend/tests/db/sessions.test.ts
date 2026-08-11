import { sessions, users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

describe('Sessions table', () => {
  let database: TestDatabase;
  let userId: string;

  beforeAll(async () => {
    database = await createTestDatabase();

    const [created] = await database.db
      .insert(users)
      .values({
        email: 'session-owner@example.com',
        passwordHash: 'not-a-real-hash',
        fullName: 'Session Owner',
      })
      .returning({ id: users.id });

    userId = created!.id;
  });

  afterAll(async () => {
    await database?.drop();
  });

  const inAnHour = () => new Date(Date.now() + 3_600_000);

  it('Defaults a new session to live, with an id and a creation stamp', async () => {
    const [created] = await database.db
      .insert(sessions)
      .values({ userId, tokenHash: 'a-digest', expiresAt: inAnHour() })
      .returning();

    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created?.revokedAt).toBeNull();
    expect(created?.createdAt).toBeInstanceOf(Date);
  });

  it('Refuses a session with no expiry, which would never end', async () => {
    await expect(
      database.pool.query(`INSERT INTO sessions (user_id, token_hash) VALUES ($1, 'a-digest')`, [
        userId,
      ]),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('Refuses a session belonging to nobody', async () => {
    await expect(
      database.pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ('11111111-1111-4111-8111-111111111111', 'a-digest', now())`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('Takes its owner down with it, leaving no session a deleted user could still use', async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        email: 'departing@example.com',
        passwordHash: 'not-a-real-hash',
        fullName: 'Departing User',
      })
      .returning({ id: users.id });

    await database.db
      .insert(sessions)
      .values({ userId: owner!.id, tokenHash: 'a-digest', expiresAt: inAnHour() });

    await database.db.delete(users).where(eq(users.id, owner!.id));

    expect(await database.db.select().from(sessions).where(eq(sessions.userId, owner!.id))).toEqual(
      [],
    );
  });

  it('Stores a revocation time, which is what logout will set', async () => {
    const [created] = await database.db
      .insert(sessions)
      .values({ userId, tokenHash: 'a-digest', expiresAt: inAnHour() })
      .returning({ id: sessions.id });

    const revokedAt = new Date();
    const [revoked] = await database.db
      .update(sessions)
      .set({ revokedAt })
      .where(eq(sessions.id, created!.id))
      .returning();

    expect(revoked?.revokedAt?.toISOString()).toBe(revokedAt.toISOString());
  });

  it('Indexes the owner, which every session lookup filters on', async () => {
    const { rows } = await database.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'sessions'`,
    );

    expect(rows.map((row) => row.indexname)).toContain('sessions_user_id_idx');
  });
});
