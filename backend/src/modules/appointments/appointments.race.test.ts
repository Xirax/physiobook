import { errorCodes } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// A Sunday; the Monday after is on CET (UTC+1), so 09:00 Warsaw is 08:00Z.
const NOW = new Date('2026-11-01T12:00:00Z');
const SLOT = '2026-11-02T08:00:00Z';

const N = 20;
const ITERATIONS = Array.from({ length: 10 }, (_, index) => index + 1);

// Each patient registers through the real endpoint, so seeding pays N bcrypt
// hashes at production cost — well past the default 10 s hook timeout.
const SEEDING_TIMEOUT_MS = 60_000;

interface Patient {
  token: string;
  id: string;
}

interface LedgerRow {
  block_id: string;
  status: string;
  appointment_id: string | null;
  user_id: string | null;
}

describe('Concurrent booking race for one slot', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let patients: Patient[];

  const register = async (index: number): Promise<Patient> => {
    const body = (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: `racer-${String(index)}@example.com`,
          password: 'correct-horse-battery',
          full_name: `Racer ${String(index)}`,
        },
      })
    ).json();
    return { token: body.token as string, id: body.user.id as string };
  };

  const book = (token: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: '/appointments',
      payload: { start: SLOT },
      headers: { authorization: `Bearer ${token}` },
    });

  const statusCounts = (responses: LightMyRequestResponse[]): Record<number, number> => {
    const counts: Record<number, number> = {};
    for (const { statusCode } of responses) counts[statusCode] = (counts[statusCode] ?? 0) + 1;
    return counts;
  };

  const ledger = async (): Promise<LedgerRow[]> => {
    const { rows } = await database.pool.query<LedgerRow>(
      `SELECT b.id AS block_id, b.status, a.id AS appointment_id, a.user_id
         FROM calendar_blocks b
         LEFT JOIN appointments a ON a.block_id = b.id`,
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

    patients = await Promise.all(Array.from({ length: N }, (_, index) => register(index)));

    const adminToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@physiobook.local', password: 'ChangeMe123!' },
      })
    ).json().token as string;

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
  }, SEEDING_TIMEOUT_MS);

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  describe(`${String(N)} distinct patients`, () => {
    it.each(ITERATIONS)(
      'Iteration %i: exactly one books, every other gets a clean 409 SLOT_TAKEN',
      async () => {
        const responses = await Promise.all(patients.map(({ token }) => book(token)));

        expect(statusCounts(responses)).toEqual({ 201: 1, 409: N - 1 });

        const winnerIndex = responses.findIndex(({ statusCode }) => statusCode === 201);
        const winner = responses[winnerIndex]!;
        for (const loser of responses.filter((response) => response !== winner)) {
          expect(loser.json()).toEqual({
            code: errorCodes.SLOT_TAKEN,
            message: expect.any(String),
          });
        }

        expect(await ledger()).toEqual([
          {
            block_id: expect.any(String),
            status: 'active',
            appointment_id: winner.json().id,
            user_id: patients[winnerIndex]!.id,
          },
        ]);
      },
    );
  });

  describe('One patient double-submitting', () => {
    it.each(ITERATIONS)(
      `Iteration %i: ${String(N)} identical requests from one patient book exactly once`,
      async () => {
        const [patient] = patients;
        const responses = await Promise.all(Array.from({ length: N }, () => book(patient!.token)));

        expect(statusCounts(responses)).toEqual({ 201: 1, 409: N - 1 });

        const winner = responses.find(({ statusCode }) => statusCode === 201)!;
        expect(await ledger()).toEqual([
          {
            block_id: expect.any(String),
            status: 'active',
            appointment_id: winner.json().id,
            user_id: patient!.id,
          },
        ]);
      },
    );
  });
});
