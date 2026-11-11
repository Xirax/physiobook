import { randomUUID } from 'node:crypto';

import { appointmentSchema, errorCodes } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { QUEUES } from '../../jobs/boss.js';
import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// Monday 2026-11-02 on CET: the 09:00-13:00 Warsaw window is 08:00-12:00Z.
const BOOKED_AT = new Date('2026-11-01T09:00:00Z');
const SAME_DAY = new Date('2026-11-02T09:30:00Z');
const START = '2026-11-02T10:00:00.000Z';
const TOKENS_OUTLIVE_THE_CLOCK_JUMP = 7 * 24 * 3600;

describe('POST /admin/appointments/:id/cancel', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let now = BOOKED_AT;

  let patientToken: string;
  let adminToken: string;

  const withToken = (token?: string) =>
    token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } };

  const book = async (): Promise<string> => {
    now = BOOKED_AT;
    const response = await app.inject({
      method: 'POST',
      url: '/appointments',
      payload: { start: START },
      ...withToken(patientToken),
    });
    now = SAME_DAY;
    return response.json().id;
  };

  const adminCancel = (id: string, token?: string): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url: `/admin/appointments/${id}/cancel`, ...withToken(token) });

  const blockStatusOf = async (appointmentId: string) => {
    const { rows } = await database.pool.query<{ status: string }>(
      `SELECT b.status FROM appointments a JOIN calendar_blocks b ON b.id = a.block_id
        WHERE a.id = $1`,
      [appointmentId],
    );
    return rows[0]!.status;
  };

  const cancellationJobsFor = async (appointmentId: string) => {
    const { rows } = await database.pool.query(
      `SELECT data FROM pgboss.job WHERE name = $1 AND data->>'appointmentId' = $2`,
      [QUEUES.sendCancellation, appointmentId],
    );
    return rows;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({
      databaseUrl: database.connectionString,
      now: () => now,
      jwtTtlSeconds: TOKENS_OUTLIVE_THE_CLOCK_JUMP,
    });

    patientToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'nora@example.com',
          password: 'correct-horse-battery',
          full_name: 'Nora Patient',
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

  it('Cancels a same-day appointment with 200 and the appointment as cancelled_by_admin', async () => {
    const id = await book();

    const response = await adminCancel(id, adminToken);

    expect(response.statusCode).toBe(200);
    expect(appointmentSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json()).toEqual({
      id,
      start: START,
      end: '2026-11-02T11:00:00.000Z',
      status: 'cancelled_by_admin',
    });
  });

  it('Enqueues one send-cancellation job for the appointment', async () => {
    const id = await book();

    await adminCancel(id, adminToken);

    expect(await cancellationJobsFor(id)).toEqual([{ data: { appointmentId: id } }]);
  });

  it('Puts the slot back in GET /slots so a patient can book it again', async () => {
    const id = await book();
    await adminCancel(id, adminToken);

    const slots = await app.inject({
      method: 'GET',
      url: '/slots?from=2026-11-02&to=2026-11-02',
      ...withToken(patientToken),
    });
    expect(slots.json().slots.map((slot: { start: string }) => slot.start)).toContain(START);

    const rebooked = await app.inject({
      method: 'POST',
      url: '/appointments',
      payload: { start: START },
      ...withToken(patientToken),
    });
    expect(rebooked.statusCode).toBe(201);
  });

  it('Forbids a patient with 403 and leaves the appointment active', async () => {
    const id = await book();

    const response = await adminCancel(id, patientToken);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(errorCodes.FORBIDDEN);
    expect(await blockStatusOf(id)).toBe('active');
    expect(await cancellationJobsFor(id)).toEqual([]);
  });

  it('Answers 401 without a token', async () => {
    const id = await book();

    expect((await adminCancel(id)).statusCode).toBe(401);
  });

  it('Answers 422 APPOINTMENT_ALREADY_STARTED once the appointment has started', async () => {
    const id = await book();
    now = new Date(START);

    const response = await adminCancel(id, adminToken);

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe(errorCodes.APPOINTMENT_ALREADY_STARTED);
    expect(await blockStatusOf(id)).toBe('active');
  });

  it('Answers 409 ALREADY_CANCELLED on a second cancel, enqueueing only once', async () => {
    const id = await book();
    await adminCancel(id, adminToken);

    const response = await adminCancel(id, adminToken);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe(errorCodes.ALREADY_CANCELLED);
    expect(await cancellationJobsFor(id)).toHaveLength(1);
  });

  it('Answers 404 for an unknown appointment', async () => {
    const response = await adminCancel(randomUUID(), adminToken);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe(errorCodes.NOT_FOUND);
  });

  it('Answers 400 for a non-uuid id', async () => {
    const response = await adminCancel('not-a-uuid', adminToken);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
  });
});
