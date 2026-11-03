import { errorCodes } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// A Sunday; the Monday after is on CET (UTC+1), so 09:00 Warsaw is 08:00Z.
const NOW = new Date('2026-11-01T12:00:00Z');
const SLOT = { start: '2026-11-02T08:00:00Z', end: '2026-11-02T09:00:00Z' };

const N = 20;
const ITERATIONS = Array.from({ length: 10 }, (_, index) => index + 1);

// Each patient registers through the real endpoint, so seeding pays N bcrypt
// hashes at production cost — well past the default 10 s hook timeout.
const SEEDING_TIMEOUT_MS = 60_000;

interface LedgerRow {
  block_id: string;
  kind: string;
  status: string;
}

describe('Concurrent time-off writes on one range', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let adminToken: string;
  let patientTokens: string[];

  const asAdmin = () => ({ authorization: `Bearer ${adminToken}` });

  const register = async (index: number): Promise<string> =>
    (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: `racer-${String(index)}@example.com`,
          password: 'correct-horse-battery',
          full_name: `Racer ${String(index)}`,
        },
      })
    ).json().token as string;

  const takeTimeOff = (): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url: '/time-off', headers: asAdmin(), payload: SLOT });

  const book = (token: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: '/appointments',
      payload: { start: SLOT.start },
      headers: { authorization: `Bearer ${token}` },
    });

  const statusCounts = (responses: LightMyRequestResponse[]): Record<number, number> => {
    const counts: Record<number, number> = {};
    for (const { statusCode } of responses) counts[statusCode] = (counts[statusCode] ?? 0) + 1;
    return counts;
  };

  const ledger = async (): Promise<LedgerRow[]> => {
    const { rows } = await database.pool.query<LedgerRow>(
      'SELECT id AS block_id, kind, status FROM calendar_blocks',
    );
    return rows;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({
      databaseUrl: database.connectionString,
      databasePoolMax: N + 5,
      now: () => NOW,
    });

    patientTokens = await Promise.all(Array.from({ length: N }, (_, index) => register(index)));
    adminToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@physiobook.local', password: 'ChangeMe123!' },
      })
    ).json().token as string;

    await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: asAdmin(),
      payload: {
        timezone: 'Europe/Warsaw',
        reminder_lead_hours: 24,
        cancellation_cutoff_hours: 24,
      },
    });
    await app.inject({
      method: 'PUT',
      url: '/business-hours',
      headers: asAdmin(),
      payload: { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] },
    });
  }, SEEDING_TIMEOUT_MS);

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  describe(`${String(N)} identical time-off requests`, () => {
    it.each(ITERATIONS)(
      'Iteration %i: exactly one is taken, every other gets a 409 naming the winner',
      async () => {
        const responses = await Promise.all(Array.from({ length: N }, () => takeTimeOff()));

        expect(statusCounts(responses)).toEqual({ 201: 1, 409: N - 1 });

        const winner = responses.find(({ statusCode }) => statusCode === 201)!;
        for (const loser of responses.filter((response) => response !== winner)) {
          expect(loser.json()).toEqual({
            code: errorCodes.TIME_OFF_CONFLICT,
            message: expect.any(String),
            conflicts: [{ id: winner.json().id, kind: 'time_off', ...isoSlot() }],
          });
        }

        expect(await ledger()).toEqual([
          { block_id: winner.json().id, kind: 'time_off', status: 'active' },
        ]);
      },
    );
  });

  describe(`One time-off request racing ${String(N)} bookings`, () => {
    it.each(ITERATIONS)(
      'Iteration %i: exactly one block wins the slot, and nobody gets a 500',
      async () => {
        const [timeOff, ...bookings] = await Promise.all([
          takeTimeOff(),
          ...patientTokens.map((token) => book(token)),
        ]);

        const [block, ...rest] = await ledger();
        expect(rest).toEqual([]);
        expect(block?.status).toBe('active');

        if (block?.kind === 'time_off') {
          expect(timeOff!.statusCode).toBe(201);
          expect(statusCounts(bookings)).toEqual({ 409: N });
        } else {
          expect(timeOff!.statusCode).toBe(409);
          expect(timeOff!.json().conflicts).toEqual([
            { id: block!.block_id, kind: 'appointment', ...isoSlot() },
          ]);
          expect(statusCounts(bookings)).toEqual({ 201: 1, 409: N - 1 });
        }
      },
    );
  });
});

function isoSlot(): { start: string; end: string } {
  return { start: new Date(SLOT.start).toISOString(), end: new Date(SLOT.end).toISOString() };
}
