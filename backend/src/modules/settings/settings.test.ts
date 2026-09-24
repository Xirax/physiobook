import { errorCodes, practiceSettingsSchema } from '@physiobook/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

describe('/settings', () => {
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
      url: '/settings',
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  const put = (body: Record<string, unknown>, token?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'PUT',
      url: '/settings',
      payload: body,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    });

  describe('GET /settings', () => {
    it('Answers 200 with the policy fields for any authenticated user', async () => {
      const response = await get(userToken);

      expect(response.statusCode).toBe(200);
      const body: unknown = response.json();
      expect(practiceSettingsSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({
        slot_duration_minutes: 60,
        reminder_lead_hours: 24,
        cancellation_cutoff_hours: 24,
      });
    });

    it('Refuses an unauthenticated caller with 401', async () => {
      const response = await get();

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe(errorCodes.UNAUTHORIZED);
    });
  });

  describe('PUT /settings', () => {
    it('Refuses a non-admin caller with 403', async () => {
      const response = await put(
        { timezone: 'Europe/Warsaw', reminder_lead_hours: 12, cancellation_cutoff_hours: 6 },
        userToken,
      );

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe(errorCodes.FORBIDDEN);
    });

    it('Refuses an unauthenticated caller with 401', async () => {
      const response = await put({
        timezone: 'Europe/Warsaw',
        reminder_lead_hours: 12,
        cancellation_cutoff_hours: 6,
      });

      expect(response.statusCode).toBe(401);
    });

    it('Applies a valid update for admin and persists it', async () => {
      const response = await put(
        { timezone: 'Europe/Warsaw', reminder_lead_hours: 12, cancellation_cutoff_hours: 6 },
        adminToken,
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        timezone: 'Europe/Warsaw',
        reminder_lead_hours: 12,
        cancellation_cutoff_hours: 6,
        slot_duration_minutes: 60,
      });

      const persisted = await get(adminToken);
      expect(persisted.json()).toMatchObject({ timezone: 'Europe/Warsaw' });
    });

    it('Accepts UTC, the seed default that the canonical zone list omits', async () => {
      const response = await put(
        { timezone: 'UTC', reminder_lead_hours: 24, cancellation_cutoff_hours: 24 },
        adminToken,
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ timezone: 'UTC' });
    });

    it('Rejects an invalid IANA timezone with 400', async () => {
      const response = await put(
        { timezone: 'Not/A_Zone', reminder_lead_hours: 24, cancellation_cutoff_hours: 24 },
        adminToken,
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
    });

    it('Rejects a negative cancellation cutoff with 400', async () => {
      const response = await put(
        { timezone: 'UTC', reminder_lead_hours: 24, cancellation_cutoff_hours: -1 },
        adminToken,
      );

      expect(response.statusCode).toBe(400);
    });

    it('Rejects a zero or negative reminder lead time with 400', async () => {
      const response = await put(
        { timezone: 'UTC', reminder_lead_hours: 0, cancellation_cutoff_hours: 24 },
        adminToken,
      );

      expect(response.statusCode).toBe(400);
    });

    it('Rejects an attempt to change slot_duration_minutes (unknown field) with 400', async () => {
      const response = await put(
        {
          timezone: 'UTC',
          reminder_lead_hours: 24,
          cancellation_cutoff_hours: 24,
          slot_duration_minutes: 30,
        },
        adminToken,
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);

      const persisted = await get(adminToken);
      expect(persisted.json().slot_duration_minutes).toBe(60);
    });
  });
});
