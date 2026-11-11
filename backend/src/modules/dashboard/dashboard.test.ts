import { users } from '@physiobook/db';
import { errorCodes, workloadResponseSchema } from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

const NOW = new Date('2026-11-11T12:00:00Z');

describe('GET /admin/workload', () => {
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
      payload: {
        windows: [1, 2, 3, 4, 5].map((day_of_week) => ({
          day_of_week,
          opens_at: '09:00',
          closes_at: '17:00',
        })),
      },
    });

    // Warsaw is on CET (UTC+1): Monday 2026-11-09 is fully booked, Tuesday is
    // empty, Wednesday is wholly under time-off.
    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    const mondayAt = (hour: number) => `2026-11-09T${String(hour).padStart(2, '0')}:00:00Z`;
    for (let hour = 8; hour < 16; hour += 1) {
      await database.pool.query(
        `INSERT INTO calendar_blocks (practitioner_id, kind, period)
         VALUES ($1, 'appointment', tstzrange($2, $3, '[)'))`,
        [admin!.id, mondayAt(hour), mondayAt(hour + 1)],
      );
    }
    await database.pool.query(
      `INSERT INTO calendar_blocks (practitioner_id, kind, period)
       VALUES ($1, 'time_off', tstzrange('2026-11-10T23:00:00Z', '2026-11-11T23:00:00Z', '[)'))`,
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
      url: `/admin/workload${query}`,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  it('Returns per-day capacity, booked and open to the admin, day being the default', async () => {
    const response = await get('?from=2026-11-09&to=2026-11-11', adminToken);

    expect(response.statusCode).toBe(200);
    expect(workloadResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json()).toEqual([
      { period: '2026-11-09', capacity: 8, booked: 8, open: 0 },
      { period: '2026-11-10', capacity: 8, booked: 0, open: 8 },
      { period: '2026-11-11', capacity: 0, booked: 0, open: 0 },
    ]);
  });

  it('Groups by ISO week under the Monday date', async () => {
    const response = await get('?from=2026-11-09&to=2026-11-22&granularity=week', adminToken);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { period: '2026-11-09', capacity: 32, booked: 8, open: 24 },
      { period: '2026-11-16', capacity: 40, booked: 0, open: 40 },
    ]);
  });

  it('Accepts a range of exactly 92 days', async () => {
    const response = await get('?from=2026-11-09&to=2027-02-08', adminToken);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(92);
  });

  it.each([
    ['a range over the 92-day cap', '?from=2026-11-09&to=2027-02-09'],
    ['a range that ends before it starts', '?from=2026-11-10&to=2026-11-09'],
    ['an impossible date', '?from=2026-02-30&to=2026-03-01'],
    ['a missing bound', '?from=2026-11-09'],
    ['an unknown granularity', '?from=2026-11-09&to=2026-11-10&granularity=month'],
    ['an unknown parameter', '?from=2026-11-09&to=2026-11-10&practitioner_id=x'],
  ])('Rejects %s with 400', async (_, query) => {
    const response = await get(query, adminToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
  });

  it('Refuses a non-admin with 403', async () => {
    const response = await get('?from=2026-11-09&to=2026-11-10', userToken);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(errorCodes.FORBIDDEN);
  });

  it('Refuses an unauthenticated caller with 401', async () => {
    const response = await get('?from=2026-11-09&to=2026-11-10');

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
  });
});
