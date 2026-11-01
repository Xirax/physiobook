import { users } from '@physiobook/db';
import {
  errorCodes,
  TIME_OFF_NOTE_MAX_LENGTH,
  timeOffConflictResponseSchema,
  timeOffSchema,
} from '@physiobook/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

// A Sunday; 2026-11-02 is the Monday after, on CET (UTC+1).
const NOW = new Date('2026-11-01T12:00:00Z');

const at = (time: string) => `2026-11-02T${time}:00.000Z`;

describe('/time-off', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  let userToken: string;
  let adminToken: string;
  let practitionerId: string;

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
    // 09:00-13:00 Warsaw is 08:00-12:00Z on 2026-11-02.
    await app.inject({
      method: 'PUT',
      url: '/business-hours',
      headers: asAdmin,
      payload: { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] },
    });

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    practitionerId = admin!.id;
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  const post = (body: object, token?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: '/time-off',
      payload: body,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  const mondaySlotStarts = async (): Promise<string[]> =>
    (
      await app.inject({
        method: 'GET',
        url: '/slots?from=2026-11-02&to=2026-11-02',
        headers: { authorization: `Bearer ${userToken}` },
      })
    )
      .json()
      .slots.map((slot: { start: string }) => slot.start);

  const insertAppointmentBlock = async (start: string, end: string): Promise<string> => {
    const { rows } = await database.pool.query<{ id: string }>(
      `INSERT INTO calendar_blocks (practitioner_id, kind, period)
       VALUES ($1, 'appointment', tstzrange($2, $3, '[)'))
       RETURNING id`,
      [practitionerId, start, end],
    );
    return rows[0]!.id;
  };

  const timeOffCount = async (): Promise<number> => {
    const { rows } = await database.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM calendar_blocks WHERE kind = 'time_off'`,
    );
    return rows[0]!.count;
  };

  describe('POST /time-off', () => {
    it('Books a free range for admin with 201 and the stored block', async () => {
      const response = await post(
        { start: at('09:15'), end: at('10:45'), note: '  Dentist  ' },
        adminToken,
      );

      expect(response.statusCode).toBe(201);
      expect(timeOffSchema.safeParse(response.json()).success).toBe(true);
      expect(response.json()).toEqual({
        id: expect.any(String),
        start: at('09:15'),
        end: at('10:45'),
        note: 'Dentist',
      });
    });

    it('Answers null for an omitted note', async () => {
      const response = await post({ start: at('09:00'), end: at('10:00') }, adminToken);

      expect(response.statusCode).toBe(201);
      expect(response.json().note).toBeNull();
    });

    it('Hides the slots it covers from GET /slots', async () => {
      expect(await mondaySlotStarts()).toEqual([
        at('08:00'),
        at('09:00'),
        at('10:00'),
        at('11:00'),
      ]);

      await post({ start: at('09:30'), end: at('11:00') }, adminToken);

      expect(await mondaySlotStarts()).toEqual([at('08:00'), at('11:00')]);
    });

    it('Answers 409 listing the appointment it overlaps', async () => {
      const appointment = await insertAppointmentBlock(at('10:00'), at('11:00'));

      const response = await post({ start: at('09:00'), end: at('12:00') }, adminToken);

      expect(response.statusCode).toBe(409);
      expect(timeOffConflictResponseSchema.safeParse(response.json()).success).toBe(true);
      expect(response.json()).toEqual({
        code: errorCodes.TIME_OFF_CONFLICT,
        message: expect.any(String),
        conflicts: [{ id: appointment, kind: 'appointment', start: at('10:00'), end: at('11:00') }],
      });
      expect(await timeOffCount()).toBe(0);
    });

    it('Answers 409 listing the time-off it overlaps', async () => {
      const existing = (await post({ start: at('09:00'), end: at('11:00') }, adminToken)).json();

      const response = await post({ start: at('10:30'), end: at('12:00') }, adminToken);

      expect(response.statusCode).toBe(409);
      expect(response.json().conflicts).toEqual([
        { id: existing.id, kind: 'time_off', start: at('09:00'), end: at('11:00') },
      ]);
    });

    it('Answers 422 for a range that is already over', async () => {
      const response = await post(
        { start: '2026-11-01T09:00:00Z', end: '2026-11-01T12:00:00Z' },
        adminToken,
      );

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe(errorCodes.TIME_OFF_IN_PAST);
      expect(await timeOffCount()).toBe(0);
    });

    it.each([
      ['an end equal to its start', { start: at('09:00'), end: at('09:00') }, 'end'],
      ['an end before its start', { start: at('10:00'), end: at('09:00') }, 'end'],
      [
        'a timestamp with an offset',
        { start: '2026-11-02T10:00:00+01:00', end: at('12:00') },
        'start',
      ],
      [
        'a calendar date instead of a timestamp',
        { start: '2026-11-02', end: at('12:00') },
        'start',
      ],
      ['a missing start', { end: at('12:00') }, 'start'],
      ['a blank note', { start: at('09:00'), end: at('10:00'), note: '   ' }, 'note'],
      [
        'a note over the limit',
        { start: at('09:00'), end: at('10:00'), note: 'x'.repeat(TIME_OFF_NOTE_MAX_LENGTH + 1) },
        'note',
      ],
      ['an unknown field', { start: at('09:00'), end: at('10:00'), kind: 'appointment' }, ''],
    ])('Rejects %s with 400 and writes nothing', async (_, body, path) => {
      const response = await post(body, adminToken);

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
      expect(response.json().details).toContainEqual(expect.objectContaining({ path }));
      expect(await timeOffCount()).toBe(0);
    });

    it('Accepts a note of exactly the limit', async () => {
      const response = await post(
        { start: at('09:00'), end: at('10:00'), note: 'x'.repeat(TIME_OFF_NOTE_MAX_LENGTH) },
        adminToken,
      );

      expect(response.statusCode).toBe(201);
    });

    it('Refuses a non-admin caller with 403 and writes nothing', async () => {
      const response = await post({ start: at('09:00'), end: at('10:00') }, userToken);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe(errorCodes.FORBIDDEN);
      expect(await timeOffCount()).toBe(0);
    });

    it('Refuses an unauthenticated caller with 401', async () => {
      const response = await post({ start: at('09:00'), end: at('10:00') });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
    });
  });
});
