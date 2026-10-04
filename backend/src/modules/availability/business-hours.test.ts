import {
  errorCodes,
  weeklyBusinessHoursSchema,
  type WeeklyBusinessHours,
} from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

const window = (day_of_week: number, opens_at: string, closes_at: string) => ({
  day_of_week,
  opens_at,
  closes_at,
});

const STANDARD_WEEK: WeeklyBusinessHours = {
  windows: [1, 2, 3, 4, 5].map((day) => window(day, '09:00', '17:00')),
};

describe('/business-hours', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  const adminCredentials = { email: 'admin@physiobook.local', password: 'ChangeMe123!' };
  const account = {
    email: 'nora@example.com',
    password: 'correct-horse-battery',
    full_name: 'Nora Nurse',
  };

  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString });

    userToken = (
      await app.inject({ method: 'POST', url: '/auth/register', payload: account })
    ).json().token;
    adminToken = (
      await app.inject({ method: 'POST', url: '/auth/login', payload: adminCredentials })
    ).json().token;
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  const get = (token?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'GET',
      url: '/business-hours',
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  const put = (body: object, token?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'PUT',
      url: '/business-hours',
      payload: body,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  const storedWeek = async (): Promise<unknown> => (await get(adminToken)).json();

  beforeEach(async () => {
    expect((await put(STANDARD_WEEK, adminToken)).statusCode).toBe(200);
  });

  describe('GET /business-hours', () => {
    it('Answers 200 with the weekly windows for a non-admin user', async () => {
      const response = await get(userToken);

      expect(response.statusCode).toBe(200);
      expect(weeklyBusinessHoursSchema.safeParse(response.json()).success).toBe(true);
      expect(response.json()).toEqual(STANDARD_WEEK);
    });

    it('Refuses an unauthenticated caller with 401', async () => {
      const response = await get();

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
    });
  });

  describe('PUT /business-hours', () => {
    it('Replaces the whole week for admin and persists every window, sorted', async () => {
      const response = await put(
        { windows: [window(6, '10:00', '14:00'), window(0, '08:15', '11:45')] },
        adminToken,
      );

      const expected = { windows: [window(0, '08:15', '11:45'), window(6, '10:00', '14:00')] };
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expected);
      expect(await storedWeek()).toEqual(expected);
    });

    it('Accepts a split shift (09:00-12:00 + 14:00-18:00) on one day', async () => {
      const week = { windows: [window(3, '09:00', '12:00'), window(3, '14:00', '18:00')] };

      expect((await put(week, adminToken)).statusCode).toBe(200);
      expect(await storedWeek()).toEqual(week);
    });

    it('Accepts back-to-back windows that touch but do not overlap', async () => {
      const week = { windows: [window(3, '09:00', '12:00'), window(3, '12:00', '15:00')] };

      expect((await put(week, adminToken)).statusCode).toBe(200);
    });

    it('Accepts the same hours on different days', async () => {
      const week = { windows: [window(1, '09:00', '12:00'), window(2, '09:00', '12:00')] };

      expect((await put(week, adminToken)).statusCode).toBe(200);
    });

    it('Accepts an empty week, closing the practice', async () => {
      expect((await put({ windows: [] }, adminToken)).statusCode).toBe(200);
      expect(await storedWeek()).toEqual({ windows: [] });
    });

    it('Refuses a non-admin caller with 403 and leaves the week intact', async () => {
      const response = await put({ windows: [] }, userToken);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe(errorCodes.FORBIDDEN);
      expect(await storedWeek()).toEqual(STANDARD_WEEK);
    });

    it('Refuses an unauthenticated caller with 401', async () => {
      expect((await put({ windows: [] })).statusCode).toBe(401);
    });

    // Each invalid set follows a valid window, so a partial write would show
    // up in the stored week; paths are therefore offset by one.
    it.each([
      ['closing equal to opening', [window(1, '12:00', '12:00')], 'windows/1/closes_at'],
      ['closing before opening', [window(1, '12:00', '09:00')], 'windows/1/closes_at'],
      ['day_of_week above 6', [window(7, '09:00', '12:00')], 'windows/1/day_of_week'],
      ['day_of_week below 0', [window(-1, '09:00', '12:00')], 'windows/1/day_of_week'],
      ['a fractional day_of_week', [window(1.5, '09:00', '12:00')], 'windows/1/day_of_week'],
      ['a malformed time', [window(1, '9:00', '12:00')], 'windows/1/opens_at'],
      ['24:00 as a time', [window(1, '09:00', '24:00')], 'windows/1/closes_at'],
      [
        'overlapping same-day windows',
        [window(2, '09:00', '13:00'), window(2, '12:00', '18:00')],
        'windows/2',
      ],
      [
        'a window nested inside another on the same day',
        [window(2, '08:00', '18:00'), window(2, '10:00', '11:00')],
        'windows/2',
      ],
    ])('Rejects %s with 400 and writes nothing', async (_, windows, path) => {
      const response = await put(
        { windows: [window(5, '07:00', '08:00'), ...windows] },
        adminToken,
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
      expect(response.json().details).toContainEqual(expect.objectContaining({ path }));
      expect(await storedWeek()).toEqual(STANDARD_WEEK);
    });

    it.each([
      ['an unknown window field', { windows: [{ ...window(1, '09:00', '12:00'), id: 'x' }] }],
      ['an unknown top-level field', { windows: [], timezone: 'UTC' }],
      ['a missing windows array', {}],
    ])('Rejects %s with 400', async (_, body) => {
      const response = await put(body, adminToken);

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
      expect(await storedWeek()).toEqual(STANDARD_WEEK);
    });
  });
});
