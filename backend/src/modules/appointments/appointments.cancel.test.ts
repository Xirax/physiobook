import { appointmentSchema, errorCodes } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// A Sunday; the Monday 09:00-13:00 Warsaw window is 08:00-12:00Z (CET), so
// with a 24h cutoff the 10:00Z slot is 25h away and the 08:00Z slot 23h away.
const NOW = new Date('2026-11-01T09:00:00Z');

const at = (time: string) => `2026-11-02T${time}:00.000Z`;

const IN_25_HOURS = at('10:00');
const IN_23_HOURS = at('08:00');

describe('DELETE /appointments/:id', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  let noraToken: string;
  let otisToken: string;
  let adminToken: string;

  const register = async (email: string, fullName: string): Promise<string> =>
    (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'correct-horse-battery', full_name: fullName },
      })
    ).json().token;

  const withToken = (token?: string) =>
    token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } };

  const book = async (start: string, token = noraToken): Promise<string> =>
    (
      await app.inject({
        method: 'POST',
        url: '/appointments',
        payload: { start },
        ...withToken(token),
      })
    ).json().id;

  const cancel = (id: string, token?: string): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'DELETE', url: `/appointments/${id}`, ...withToken(token) });

  const mondaySlotStarts = async (): Promise<string[]> =>
    (
      await app.inject({
        method: 'GET',
        url: '/slots?from=2026-11-02&to=2026-11-02',
        ...withToken(otisToken),
      })
    )
      .json()
      .slots.map((slot: { start: string }) => slot.start);

  const activeBlockCount = async (): Promise<number> => {
    const { rows } = await database.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM calendar_blocks WHERE status = 'active'",
    );
    return rows[0]!.count;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString, now: () => NOW });

    noraToken = await register('nora@example.com', 'Nora Patient');
    otisToken = await register('otis@example.com', 'Otis Patient');
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
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  it('Cancels an appointment 25h ahead with 200 and the cancelled appointment', async () => {
    const id = await book(IN_25_HOURS);

    const response = await cancel(id, noraToken);

    expect(response.statusCode).toBe(200);
    expect(appointmentSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json()).toEqual({
      id,
      start: IN_25_HOURS,
      end: at('11:00'),
      status: 'cancelled',
    });
    expect(await activeBlockCount()).toBe(0);
  });

  it('Puts the slot back into GET /slots and lets another user book it', async () => {
    const id = await book(IN_25_HOURS);
    expect(await mondaySlotStarts()).not.toContain(IN_25_HOURS);

    await cancel(id, noraToken);

    expect(await mondaySlotStarts()).toContain(IN_25_HOURS);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/appointments',
          payload: { start: IN_25_HOURS },
          ...withToken(otisToken),
        })
      ).statusCode,
    ).toBe(201);
  });

  it('Answers 422 CANCELLATION_CUTOFF_PASSED 23h ahead and keeps the appointment', async () => {
    const id = await book(IN_23_HOURS);

    const response = await cancel(id, noraToken);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: errorCodes.CANCELLATION_CUTOFF_PASSED,
      message: expect.any(String),
    });
    expect(await activeBlockCount()).toBe(1);
  });

  it("Answers 403 FORBIDDEN for another user's appointment and keeps it", async () => {
    const id = await book(IN_25_HOURS);

    const response = await cancel(id, otisToken);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(errorCodes.FORBIDDEN);
    expect(await activeBlockCount()).toBe(1);
  });

  it('Answers 404 NOT_FOUND for an id that does not exist', async () => {
    const response = await cancel('11111111-1111-4111-8111-111111111111', noraToken);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe(errorCodes.NOT_FOUND);
  });

  it('Answers 409 ALREADY_CANCELLED to a second cancel of the same appointment', async () => {
    const id = await book(IN_25_HOURS);
    await cancel(id, noraToken);

    const response = await cancel(id, noraToken);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe(errorCodes.ALREADY_CANCELLED);
  });

  it('Answers 400 VALIDATION_FAILED for an id that is not a uuid', async () => {
    const response = await cancel('not-a-uuid', noraToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
  });

  it('Answers 401 without a token, before looking at the id', async () => {
    const response = await cancel('not-a-uuid');

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
  });

  it("Answers 403 to the admin, even for a patient's appointment", async () => {
    const id = await book(IN_25_HOURS);

    const response = await cancel(id, adminToken);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(errorCodes.FORBIDDEN);
    expect(await activeBlockCount()).toBe(1);
  });
});
