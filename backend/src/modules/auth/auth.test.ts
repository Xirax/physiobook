import { sessions, users } from '@physiobook/db';
import { errorCodes, PASSWORD_MAX_BYTES, PASSWORD_MIN_BYTES } from '@physiobook/shared';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  TEST_JWT_SECRET,
  TEST_JWT_TTL_SECONDS,
} from '../../../tests/helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { verifyAccessToken } from '../../lib/tokens.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../plugins/cookie.js';

describe('POST /auth/register', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildTestApp({ databaseUrl: database.connectionString });
  });

  afterAll(async () => {
    await app?.close();
    await database?.drop();
  });

  const register = (
    payload: NonNullable<InjectOptions['payload']>,
  ): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url: '/auth/register', payload });

  const validPayload = {
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    full_name: 'Ada Lovelace',
  };

  describe('Happy path', () => {
    it('Creates a user and returns 201 with the user and a token', async () => {
      const response = await register({ ...validPayload });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.user).toEqual({
        id: expect.any(String),
        email: validPayload.email,
        full_name: validPayload.full_name,
        role: 'user',
        created_at: expect.any(String),
      });
      expect(body.token).toEqual(expect.any(String));
    });

    it('Returns a token carrying sub, role and exp', async () => {
      const response = await register({ ...validPayload, email: 'token@example.com' });
      const { user, token } = response.json();

      const claims = verifyAccessToken(token, TEST_JWT_SECRET);

      expect(claims.sub).toBe(user.id);
      expect(claims.role).toBe('user');
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 900);
    });

    it('Logs the new user in: one session, and a token that names it', async () => {
      const response = await register({ ...validPayload, email: 'session@example.com' });
      const { user, token } = response.json();

      const rows = await database.db.select().from(sessions).where(eq(sessions.userId, user.id));

      expect(rows).toHaveLength(1);
      expect(verifyAccessToken(token, TEST_JWT_SECRET).session_id).toBe(rows[0]?.id);
    });

    it('Sets the same refresh cookie a login would', async () => {
      const response = await register({ ...validPayload, email: 'cookie@example.com' });
      const cookie = response.cookies.find((each) => each.name === REFRESH_COOKIE_NAME);

      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toMatch(/strict/i);
      expect(cookie?.path).toBe(REFRESH_COOKIE_PATH);
    });

    it('Never returns the password hash', async () => {
      const response = await register({ ...validPayload, email: 'no-hash@example.com' });

      expect(response.body).not.toContain('password');
      expect(response.body).not.toContain('$2b$');
    });

    it('Stores the password only as a bcrypt hash', async () => {
      const password = 'a-password-worth-hashing';
      await register({ ...validPayload, email: 'stored@example.com', password });

      const [stored] = await database.db
        .select()
        .from(users)
        .where(eq(users.email, 'stored@example.com'));

      expect(stored).toBeDefined();
      expect(stored!.passwordHash).not.toBe(password);
      expect(stored!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      await expect(bcrypt.compare(password, stored!.passwordHash)).resolves.toBe(true);
    });
  });

  describe('Validation', () => {
    const expectValidationFailure = (response: LightMyRequestResponse) => {
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
    };

    it('Rejects a missing full_name', async () => {
      const { full_name: _omitted, ...withoutName } = validPayload;

      expectValidationFailure(await register(withoutName));
    });

    it('Rejects a missing email', async () => {
      const { email: _omitted, ...withoutEmail } = validPayload;

      expectValidationFailure(await register(withoutEmail));
    });

    it('Rejects a missing password', async () => {
      const { password: _omitted, ...withoutPassword } = validPayload;

      expectValidationFailure(await register(withoutPassword));
    });

    it('Rejects a full_name of only whitespace', async () => {
      expectValidationFailure(await register({ ...validPayload, full_name: '   ' }));
    });

    it('Rejects a malformed email', async () => {
      expectValidationFailure(await register({ ...validPayload, email: 'not-an-email' }));
    });

    it(`Rejects a password under ${String(PASSWORD_MIN_BYTES)} bytes`, async () => {
      expectValidationFailure(await register({ ...validPayload, password: 'short' }));
    });

    it(`Rejects a password over ${String(PASSWORD_MAX_BYTES)} bytes`, async () => {
      expectValidationFailure(
        await register({ ...validPayload, password: 'x'.repeat(PASSWORD_MAX_BYTES + 1) }),
      );
    });

    it('Measures the password bound in bytes, not characters', async () => {
      expectValidationFailure(await register({ ...validPayload, password: '🔒'.repeat(25) }));
    });

    it('Counts a two-byte character as two bytes', async () => {
      expectValidationFailure(await register({ ...validPayload, password: 'é'.repeat(37) }));
    });

    it('Accepts a two-byte-character password that fits exactly', async () => {
      const response = await register({
        ...validPayload,
        email: 'accented@example.com',
        password: 'é'.repeat(36),
      });

      expect(response.statusCode).toBe(201);
    });

    it('Accepts a password at exactly the byte limit', async () => {
      const response = await register({
        ...validPayload,
        email: 'boundary@example.com',
        password: 'x'.repeat(PASSWORD_MAX_BYTES),
      });

      expect(response.statusCode).toBe(201);
    });

    it('Creates nothing when validation fails', async () => {
      await register({ email: 'rejected@example.com', password: 'short', full_name: 'Nope' });

      const found = await database.db
        .select()
        .from(users)
        .where(eq(users.email, 'rejected@example.com'));

      expect(found).toHaveLength(0);
    });
  });

  describe('Privilege escalation', () => {
    it('Rejects a client-supplied role', async () => {
      const response = await register({
        ...validPayload,
        email: 'escalate@example.com',
        role: 'admin',
      });

      expect(response.statusCode).toBe(400);

      const admins = await database.db.select().from(users).where(eq(users.role, 'admin'));

      expect(admins).toHaveLength(1);
      expect(admins[0]?.email).toBe('admin@physiobook.local');
    });

    it('Creates a user, not an admin, when role is stripped from an otherwise valid body', async () => {
      const response = await register({ ...validPayload, email: 'plain@example.com' });

      expect(response.statusCode).toBe(201);
      expect(response.json().user.role).toBe('user');

      const [created] = await database.db
        .select()
        .from(users)
        .where(eq(users.email, 'plain@example.com'));

      expect(created?.role).toBe('user');
    });
  });

  describe('Duplicate email', () => {
    it('Returns 409 for an address that differs only in case', async () => {
      const first = await register({ ...validPayload, email: 'Duplicate@Example.com' });
      expect(first.statusCode).toBe(201);

      const second = await register({ ...validPayload, email: 'duplicate@example.com' });

      expect(second.statusCode).toBe(409);
      expect(second.json().code).toBe(errorCodes.EMAIL_TAKEN);
    });

    it('Leaves the original account untouched', async () => {
      await register({
        ...validPayload,
        email: 'original@example.com',
        full_name: 'First Owner',
      });
      await register({
        ...validPayload,
        email: 'ORIGINAL@example.com',
        full_name: 'Second Owner',
      });

      const found = await database.db
        .select()
        .from(users)
        .where(eq(users.email, 'original@example.com'));

      expect(found).toHaveLength(1);
      expect(found[0]?.fullName).toBe('First Owner');
    });

    it('Does not leak the address back to the caller', async () => {
      await register({ ...validPayload, email: 'enumerate@example.com' });
      const response = await register({ ...validPayload, email: 'enumerate@example.com' });

      expect(response.statusCode).toBe(409);
      expect(response.body).not.toContain('enumerate@example.com');
    });

    it('Reports 409, not 500, when two registrations of one address race', async () => {
      const responses = await Promise.all([
        register({ ...validPayload, email: 'race@example.com' }),
        register({ ...validPayload, email: 'race@example.com' }),
      ]);

      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([201, 409]);

      const found = await database.db
        .select()
        .from(users)
        .where(eq(users.email, 'race@example.com'));
      expect(found).toHaveLength(1);
    });
  });

  describe('Request shape', () => {
    it('Rejects a JSON body that is not an object', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { 'content-type': 'application/json' },
        payload: '"just a string"',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.VALIDATION_FAILED);
    });

    it('Rejects malformed JSON in the same error shape', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { 'content-type': 'application/json' },
        payload: '{"email": ',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe(errorCodes.BAD_REQUEST);
    });

    it('Rejects a body sent with no content type at all', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: 'email=ada@example.com',
      });

      expect(response.statusCode).toBe(415);
      expect(response.json().code).toBe(errorCodes.BAD_REQUEST);
    });

    it('Names the offending field in the error details', async () => {
      const { full_name: _omitted, ...withoutName } = validPayload;
      const response = await register(withoutName);

      expect(response.json().details).toEqual([{ path: 'full_name', message: expect.any(String) }]);
    });

    it('Reports an unrecognised field against the body rather than a field', async () => {
      const response = await register({ ...validPayload, unexpected: 'value' });

      expect(response.statusCode).toBe(400);
      expect(response.json().details).toEqual([
        { path: '', message: expect.stringContaining('unexpected') },
      ]);
    });

    it('Answers unknown routes in the same error shape', async () => {
      const response = await app.inject({ method: 'POST', url: '/auth/nope' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        code: errorCodes.NOT_FOUND,
        message: expect.any(String),
      });
    });
  });

  describe('With an injected clock', () => {
    const signedAt = '2026-07-29T10:00:00Z';
    let clockedApp: FastifyInstance;

    beforeAll(async () => {
      clockedApp = await buildTestApp({
        databaseUrl: database.connectionString,
        now: () => new Date(signedAt),
      });
    });

    afterAll(async () => {
      await clockedApp?.close();
    });

    it('Stamps the token from the injected clock, not the wall clock', async () => {
      const response = await clockedApp.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { ...validPayload, email: 'clocked@example.com' },
      });

      expect(response.statusCode).toBe(201);

      const issuedAt = Math.floor(Date.parse(signedAt) / 1000);
      const claims = verifyAccessToken(response.json().token, TEST_JWT_SECRET, {
        now: () => new Date(signedAt),
      });

      expect(claims.iat).toBe(issuedAt);
      expect(claims.exp).toBe(issuedAt + TEST_JWT_TTL_SECONDS);
    });
  });
});
