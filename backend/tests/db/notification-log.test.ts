import { notificationLog, users } from '@physiobook/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

describe('notification_log table', () => {
  let database: TestDatabase;
  let userId: string;

  beforeAll(async () => {
    database = await createTestDatabase();

    const [created] = await database.db
      .insert(users)
      .values({ email: 'notified@example.com', passwordHash: 'x', fullName: 'Notified User' })
      .returning({ id: users.id });

    userId = created!.id;
  });

  afterAll(async () => {
    await database?.drop();
  });

  const entry = (dedupeKey: string) => ({
    recipientRole: 'user' as const,
    recipientUserId: userId,
    type: 'reminder_user',
    dedupeKey,
    payload: { subject: 'Reminder' },
  });

  it('stamps a logged notification with an id and the time it was sent', async () => {
    const [row] = await database.db
      .insert(notificationLog)
      .values(entry('reminder:user:stamp'))
      .returning();

    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.sentAt).toBeInstanceOf(Date);
    expect(row?.payload).toEqual({ subject: 'Reminder' });
  });

  it('rejects a second notification with the same dedupe key', async () => {
    await database.db.insert(notificationLog).values(entry('reminder:user:twice'));

    await expect(
      database.db.insert(notificationLog).values(entry('reminder:user:twice')),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'notification_log_dedupe_key_unique' },
    });
  });

  it('allows a notification without a recipient user', async () => {
    const [row] = await database.db
      .insert(notificationLog)
      .values({
        ...entry('reminder:admin-run:anon'),
        recipientUserId: null,
        recipientRole: 'admin',
      })
      .returning();

    expect(row?.recipientUserId).toBeNull();
  });

  it('refuses a recipient user that does not exist', async () => {
    await expect(
      database.db.insert(notificationLog).values({
        ...entry('reminder:user:ghost'),
        recipientUserId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});
