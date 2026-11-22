import { adminAppointmentsResponseSchema, errorCodes } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// Monday 2026-11-02 on CET: the 09:00-13:00 Warsaw window is 08:00-12:00Z.
const BOOKED_AT = new Date('2026-11-01T09:00:00Z');
const DURING_FIRST_APPOINTMENT = new Date('2026-11-02T08:30:00Z');
const TOKENS_OUTLIVE_THE_CLOCK_JUMP = 7 * 24 * 3600;

const at = (hourUtc: number) => `2026-11-02T${String(hourUtc).padStart(2, '0')}:00:00.000Z`;

describe('GET /admin/appointments', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let now = BOOKED_AT;

  let noraToken: string;
  let olafToken: string;
  let adminToken: string;

  const withToken = (token?: string) =>
    token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } };

  const list = (query: string, token?: string): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'GET', url: `/admin/appointments${query}`, ...withToken(token) });

  const summaryOf = (response: LightMyRequestResponse) =>
    adminAppointmentsResponseSchema
      .parse(response.json())
      .map(({ start, status, patient }) => ({ start, status, patient: patient.full_name }));

  const register = async (email: string, fullName: string): Promise<string> =>
    (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'correct-horse-battery', full_name: fullName },
      })
    ).json().token;

  const book = async (start: string, token: string): Promise<string> =>
    (
      await app.inject({
        method: 'POST',
        url: '/appointments',
        payload: { start },
        ...withToken(token),
      })
    ).json().id;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({
      databaseUrl: database.connectionString,
      now: () => now,
      jwtTtlSeconds: TOKENS_OUTLIVE_THE_CLOCK_JUMP,
    });

    noraToken = await register('nora@example.com', 'Nora Patient');
    olafToken = await register('olaf@example.com', 'Olaf Patient');
    adminToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@physiobook.local', password: 'ChangeMe123!' },
      })
    ).json().token;

    const asAdmin = withToken(adminToken);
    await app.inject({
      method: 'PUT',
      url: '/settings',
      ...asAdmin,
      payload: {
        timezone: 'Europe/Warsaw',
        reminder_lead_hours: 24,
        cancellation_cutoff_hours: 24,
      },
    });
    await app.inject({
      method: 'PUT',
      url: '/business-hours',
      ...asAdmin,
      payload: { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] },
    });

    await book(at(10), noraToken);
    await book(at(8), noraToken);
    await book(at(9), olafToken);
    const cancelled = await book(at(11), olafToken);
    await app.inject({
      method: 'POST',
      url: `/admin/appointments/${cancelled}/cancel`,
      ...asAdmin,
    });

    now = DURING_FIRST_APPOINTMENT;
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  it('Defaults to upcoming active appointments across all patients, ordered by start', async () => {
    const response = await list('', adminToken);

    expect(response.statusCode).toBe(200);
    expect(summaryOf(response)).toEqual([
      { start: at(9), status: 'active', patient: 'Olaf Patient' },
      { start: at(10), status: 'active', patient: 'Nora Patient' },
    ]);
  });

  it('Returns each row with its end and the patient’s id, email and name', async () => {
    const [first] = (await list('', adminToken)).json();

    expect(first).toEqual({
      id: expect.any(String),
      start: at(9),
      end: at(10),
      status: 'active',
      patient: { id: expect.any(String), email: 'olaf@example.com', full_name: 'Olaf Patient' },
    });
  });

  it('Reveals a past appointment through a date range', async () => {
    const response = await list('?from=2026-11-02&to=2026-11-02', adminToken);

    expect(response.statusCode).toBe(200);
    expect(summaryOf(response)).toEqual([
      { start: at(8), status: 'active', patient: 'Nora Patient' },
      { start: at(9), status: 'active', patient: 'Olaf Patient' },
      { start: at(10), status: 'active', patient: 'Nora Patient' },
    ]);
  });

  it('Reveals a cancelled appointment through the status filter', async () => {
    const response = await list('?status=cancelled_by_admin', adminToken);

    expect(response.statusCode).toBe(200);
    expect(summaryOf(response)).toEqual([
      { start: at(11), status: 'cancelled_by_admin', patient: 'Olaf Patient' },
    ]);
  });

  it('Returns every status and the past with status=any over a range', async () => {
    const response = await list('?from=2026-11-02&to=2026-11-02&status=any', adminToken);

    expect(summaryOf(response).map(({ start, status }) => [start, status])).toEqual([
      [at(8), 'active'],
      [at(9), 'active'],
      [at(10), 'active'],
      [at(11), 'cancelled_by_admin'],
    ]);
  });

  it('Accepts a range of exactly 92 days', async () => {
    const response = await list('?from=2026-11-02&to=2027-02-01', adminToken);

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['only a start date', '?from=2026-11-02'],
    ['only an end date', '?to=2026-11-02'],
    ['a range over the 92-day cap', '?from=2026-11-02&to=2027-02-02'],
    ['a range that ends before it starts', '?from=2026-11-03&to=2026-11-02'],
    ['an impossible date', '?from=2026-02-30&to=2026-03-01'],
    ['an unknown status', '?status=pending'],
    ['an unknown parameter', '?patient=nora'],
  ])('Rejects %s with 400', async (_, query) => {
    const response = await list(query, adminToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
  });

  it('Refuses a non-admin with 403', async () => {
    const response = await list('', noraToken);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(errorCodes.FORBIDDEN);
  });

  it('Refuses an unauthenticated caller with 401', async () => {
    const response = await list('');

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
  });
});
