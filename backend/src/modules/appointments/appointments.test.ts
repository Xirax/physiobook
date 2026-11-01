import { appointmentSchema, errorCodes } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// A Sunday; 2026-11-02 is the Monday after, on CET (UTC+1), so the 09:00-13:00
// Warsaw window is 08:00-12:00Z.
const NOW = new Date('2026-11-01T12:00:00Z');

const at = (time: string) => `2026-11-02T${time}:00.000Z`;

describe('POST /appointments', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  let noraToken: string;
  let noraId: string;
  let otisToken: string;
  let otisId: string;
  let adminToken: string;

  const register = async (email: string, fullName: string) => {
    const body = (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'correct-horse-battery', full_name: fullName },
      })
    ).json();
    return { token: body.token as string, id: body.user.id as string };
  };

  const post = (
    body: unknown,
    token?: string,
    target: FastifyInstance = app,
  ): Promise<LightMyRequestResponse> =>
    target.inject({
      method: 'POST',
      url: '/appointments',
      payload: body as object,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  const bookedUserIds = async (): Promise<string[]> => {
    const { rows } = await database.pool.query<{ user_id: string }>(
      'SELECT user_id FROM appointments',
    );
    return rows.map((row) => row.user_id);
  };

  const blockCount = async (): Promise<number> => {
    const { rows } = await database.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM calendar_blocks',
    );
    return rows[0]!.count;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString, now: () => NOW });

    ({ token: noraToken, id: noraId } = await register('nora@example.com', 'Nora Patient'));
    ({ token: otisToken, id: otisId } = await register('otis@example.com', 'Otis Patient'));
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
      payload: { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] },
    });
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  it('Books a free slot with 201 and the created appointment', async () => {
    const response = await post({ start: '2026-11-02T08:00:00Z' }, noraToken);

    expect(response.statusCode).toBe(201);
    expect(appointmentSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json()).toEqual({
      id: expect.any(String),
      start: at('08:00'),
      end: at('09:00'),
      status: 'active',
    });
    expect(await bookedUserIds()).toEqual([noraId]);
  });

  it('Takes the booked slot out of GET /slots', async () => {
    await post({ start: at('08:00') }, noraToken);

    const slots = (
      await app.inject({
        method: 'GET',
        url: '/slots?from=2026-11-02&to=2026-11-02',
        headers: { authorization: `Bearer ${otisToken}` },
      })
    )
      .json()
      .slots.map((slot: { start: string }) => slot.start);

    expect(slots).toEqual([at('09:00'), at('10:00'), at('11:00')]);
  });

  it('Answers 409 SLOT_TAKEN for a slot someone else holds, leaving no orphan block', async () => {
    await post({ start: at('10:00') }, noraToken);

    const response = await post({ start: at('10:00') }, otisToken);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: errorCodes.SLOT_TAKEN, message: expect.any(String) });
    expect(await blockCount()).toBe(1);
    expect(await bookedUserIds()).toEqual([noraId]);
  });

  it('Answers 409 SLOT_TAKEN for a slot under time off', async () => {
    await app.inject({
      method: 'POST',
      url: '/time-off',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { start: at('09:30'), end: at('10:30') },
    });

    const response = await post({ start: at('10:00') }, noraToken);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe(errorCodes.SLOT_TAKEN);
  });

  it.each([
    ['off the hour', at('08:30')],
    ['out of hours', at('12:00')],
    ['in the past', '2026-10-26T08:00:00.000Z'],
    ['beyond the 62-day horizon', '2027-01-04T08:00:00.000Z'],
  ])('Answers 422 SLOT_NOT_BOOKABLE for a start %s', async (_, start) => {
    const response = await post({ start }, noraToken);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: errorCodes.SLOT_NOT_BOOKABLE,
      message: expect.any(String),
    });
    expect(await blockCount()).toBe(0);
  });

  it.each([
    ['an empty body', {}],
    ['a non-string start', { start: 1_793_520_000_000 }],
    ['a date without a time', { start: '2026-11-02' }],
    ['a start with an offset instead of Z', { start: '2026-11-02T09:00:00+01:00' }],
    ['an unknown field', { start: at('08:00'), note: 'hi' }],
  ])('Answers 400 VALIDATION_FAILED for %s', async (_, body) => {
    const response = await post(body, noraToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
    expect(await blockCount()).toBe(0);
  });

  it("Rejects a payload naming another user's id instead of booking for them", async () => {
    const response = await post({ start: at('08:00'), user_id: otisId }, noraToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
    expect(await bookedUserIds()).toEqual([]);
  });

  it('Answers 401 without a token, before looking at the body', async () => {
    const response = await post({ start: 'not-a-time' });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
  });

  it('Answers 403 to the admin, who books time off instead', async () => {
    const response = await post({ start: at('08:00') }, adminToken);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(errorCodes.FORBIDDEN);
    expect(await blockCount()).toBe(0);
  });

  describe('Rate limiting', () => {
    const withLimits = (limits: { rateLimitMax?: number; bookingRateLimitMax?: number }) =>
      buildTestApp({ databaseUrl: database.connectionString, now: () => NOW, ...limits });

    it('Answers 429 in the standard error shape once a user passes the limit', async () => {
      const limited = await withLimits({ bookingRateLimitMax: 2 });

      try {
        expect((await post({ start: at('08:00') }, noraToken, limited)).statusCode).toBe(201);
        expect((await post({ start: at('08:00') }, noraToken, limited)).statusCode).toBe(409);

        const blocked = await post({ start: at('09:00') }, noraToken, limited);

        expect(blocked.statusCode).toBe(429);
        expect(blocked.json()).toEqual({
          code: errorCodes.RATE_LIMITED,
          message: expect.any(String),
        });
      } finally {
        await limited.close();
      }
    });

    it('Counts each user on their own, so patients behind one address do not share a bucket', async () => {
      const limited = await withLimits({ bookingRateLimitMax: 2 });

      try {
        await post({ start: at('08:00') }, noraToken, limited);
        await post({ start: at('09:00') }, noraToken, limited);
        expect((await post({ start: at('10:00') }, noraToken, limited)).statusCode).toBe(429);

        expect((await post({ start: at('10:00') }, otisToken, limited)).statusCode).toBe(201);
      } finally {
        await limited.close();
      }
    });

    it('Does not share the login bucket', async () => {
      const limited = await withLimits({ rateLimitMax: 1 });

      try {
        for (const time of ['08:00', '09:00', '10:00']) {
          expect((await post({ start: at(time) }, noraToken, limited)).statusCode).toBe(201);
        }
      } finally {
        await limited.close();
      }
    });
  });
});
