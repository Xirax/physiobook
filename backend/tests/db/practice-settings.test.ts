import { practiceSettings } from '@physiobook/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

describe('practice_settings table', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  const row = async () =>
    (await database.db.select().from(practiceSettings).where(eq(practiceSettings.id, 1)))[0];

  it('Seeds exactly one row, with defaults matching the domain rules', async () => {
    const rows = await database.db.select().from(practiceSettings);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      slotDurationMinutes: 60,
      reminderLeadHours: 24,
      cancellationCutoffHours: 24,
    });
  });

  it('Rejects a second row', async () => {
    await expect(
      database.pool.query(
        `INSERT INTO practice_settings (id, timezone) VALUES (2, 'Europe/Warsaw')`,
      ),
    ).rejects.toThrow(/violates check constraint "practice_settings_singleton"/);
  });

  it('Rejects changing the id away from 1', async () => {
    await expect(
      database.pool.query(`UPDATE practice_settings SET id = 2 WHERE id = 1`),
    ).rejects.toThrow(/violates check constraint "practice_settings_singleton"/);
  });

  it('Moves updated_at on update', async () => {
    const before = await row();
    expect(before).toBeDefined();

    await database.db
      .update(practiceSettings)
      .set({ updatedAt: sql`now() - interval '1 hour'` })
      .where(eq(practiceSettings.id, 1));

    await database.db
      .update(practiceSettings)
      .set({ reminderLeadHours: 48 })
      .where(eq(practiceSettings.id, 1));

    const after = await row();
    expect(after).toBeDefined();

    expect(after?.reminderLeadHours).toBe(48);
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('Overrides an updated_at the caller tried to set by hand', async () => {
    await database.db
      .update(practiceSettings)
      .set({ cancellationCutoffHours: 12, updatedAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(practiceSettings.id, 1));

    const after = await row();
    expect(after?.updatedAt.getFullYear()).toBeGreaterThan(2000);
  });
});
