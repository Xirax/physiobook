import { users } from '@physiobook/db';
import { errorCodes, slotsResponseSchema } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// A Sunday; the next day, 2026-11-02, is a Monday on CET (UTC+1).
const NOW = new Date('2026-11-01T12:00:00Z');

describe('GET /slots', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString, now: () => NOW });

    userToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'nora@example.com',
          password: 'correct-horse-battery',
          full_name: 'Nora Nurse',
        },
      })
    ).json().token;
    adminToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@physiobook.local', password: 'ChangeMe123!' },
      })
    ).json().token;

    const asAdmin = { authorization: `Bearer ${adminToken}` };
    await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: asAdmin,
      payload: {
        timezone: 'Europe/Warsaw',
        reminder_lead_hours: 24,
        cancellation_cutoff_hours: 24,
      },
    });
    await app.inject({
      method: 'PUT',
      url: '/business-hours',
      headers: asAdmin,
      payload: { windows: [{ day_of_week: 1, opens_at: '09:30', closes_at: '12:30' }] },
    });

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    await database.pool.query(
      `INSERT INTO calendar_blocks (practitioner_id, kind, period)
       VALUES ($1, 'appointment', tstzrange('2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', '[)'))`,
      [admin!.id],
    );
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  const get = (query: string, token?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'GET',
      url: `/slots${query}`,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  it('Returns the open slots of the range to an authenticated user, without the booked one', async () => {
    const response = await get('?from=2026-11-02&to=2026-11-08', userToken);

    expect(response.statusCode).toBe(200);
    expect(slotsResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json()).toEqual({
      timezone: 'Europe/Warsaw',
      slots: [{ start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' }],
    });
  });

  it('Answers the admin too', async () => {
    const response = await get('?from=2026-11-02&to=2026-11-02', adminToken);

    expect(response.statusCode).toBe(200);
    expect(response.json().slots).toHaveLength(1);
  });

  it('Accepts a range of exactly 62 days', async () => {
    const response = await get('?from=2026-11-02&to=2027-01-02', userToken);

    expect(response.statusCode).toBe(200);
  });

  it('Rejects a range over the 62-day cap with 400', async () => {
    const response = await get('?from=2026-11-02&to=2027-01-03', userToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
  });

  it.each([
    ['a range that ends before it starts', '?from=2026-11-09&to=2026-11-02'],
    ['an impossible date', '?from=2026-02-30&to=2026-03-01'],
    ['a timestamp instead of a date', '?from=2026-11-02T00:00:00Z&to=2026-11-03'],
    ['a missing bound', '?from=2026-11-02'],
    ['an unknown parameter', '?from=2026-11-02&to=2026-11-03&practitioner_id=x'],
  ])('Rejects %s with 400', async (_, query) => {
    const response = await get(query, userToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
  });

  it('Refuses an unauthenticated caller with 401', async () => {
    const response = await get('?from=2026-11-02&to=2026-11-08');

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
  });
});
