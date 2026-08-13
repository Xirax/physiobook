import { randomUUID } from 'node:crypto';

import { sessions } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { EmailTakenError, UnauthorizedError } from '../../lib/errors.js';
import { parseRefreshToken } from '../../lib/refresh-token.js';
import { verifyAccessToken } from '../../lib/tokens.js';
import {
  loginUser,
  refreshSession,
  registerUser,
  revokeSession,
  type AuthDependencies,
} from './auth.service.js';

const JWT_SECRET = 'a-test-secret-long-enough-for-hs256';
const JWT_TTL_SECONDS = 900;
const REFRESH_TTL_SECONDS = 604_800;

describe('RegisterUser, when the database itself fails', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.pool.query('DROP TABLE users CASCADE');
  });

  afterAll(async () => {
    await database?.drop();
  });

  const register = () =>
    registerUser(
      { email: 'ada@example.com', password: 'correct-horse-battery', full_name: 'Ada Lovelace' },
      {
        db: database.db,
        jwtSecret: JWT_SECRET,
        jwtTtlSeconds: JWT_TTL_SECONDS,
        refreshTtlSeconds: REFRESH_TTL_SECONDS,
      },
    );

  it('Does not mistake an unrelated failure for a taken email', async () => {
    await expect(register()).rejects.not.toBeInstanceOf(EmailTakenError);
  });

  it('Propagates the driver error, which names the real problem', async () => {
    await expect(register()).rejects.toMatchObject({
      code: '42P01',
    });
  });

  it('Does not carry the password hash on the error it throws', async () => {
    const error = await register().catch((caught: unknown) => caught);

    expect(String((error as Error).message)).not.toMatch(/\$2[aby]\$/);
    expect(String((error as Error).message)).not.toContain('correct-horse-battery');
  });
});

describe('refreshSession', () => {
  let database: TestDatabase;
  let dependencies: AuthDependencies;

  const openedAt = new Date('2026-08-13T09:00:00Z');
  const withinTheWindow = new Date('2026-08-13T10:00:00Z');
  const pastExpiry = new Date('2026-08-21T09:00:00Z');

  beforeAll(async () => {
    database = await createTestDatabase();
    dependencies = {
      db: database.db,
      jwtSecret: JWT_SECRET,
      jwtTtlSeconds: JWT_TTL_SECONDS,
      refreshTtlSeconds: REFRESH_TTL_SECONDS,
    };
  });

  afterAll(async () => {
    await database?.drop();
  });

  const openSession = (now: () => Date = () => openedAt) =>
    registerUser(
      {
        email: `${randomUUID()}@example.com`,
        password: 'correct-horse-battery',
        full_name: 'Ada Lovelace',
      },
      { ...dependencies, now },
    );

  const sessionIdOf = (refreshToken: string) => parseRefreshToken(refreshToken)!.sessionId;

  const rowOf = async (sessionId: string) => {
    const [row] = await database.db.select().from(sessions).where(eq(sessions.id, sessionId));

    return row;
  };

  const refreshAt = (cookie: string | undefined, now: Date) =>
    refreshSession(cookie, { ...dependencies, now: () => now });

  it('Mints a token for the same session, the same user and the held role', async () => {
    const opened = await openSession();

    const { token } = await refreshAt(opened.refreshToken, withinTheWindow);
    const claims = verifyAccessToken(token, JWT_SECRET, { now: () => withinTheWindow });

    expect(claims.session_id).toBe(sessionIdOf(opened.refreshToken));
    expect(claims.sub).toBe(opened.user.id);
    expect(claims.role).toBe('user');
  });

  it('Stamps the token from the clock at refresh time, not at login', async () => {
    const opened = await openSession();

    const { token } = await refreshAt(opened.refreshToken, withinTheWindow);
    const claims = verifyAccessToken(token, JWT_SECRET, { now: () => withinTheWindow });

    const issuedAt = Math.floor(withinTheWindow.getTime() / 1000);
    expect(claims.iat).toBe(issuedAt);
    expect(claims.exp).toBe(issuedAt + JWT_TTL_SECONDS);
  });

  it('Carries the role the account actually holds', async () => {
    const admin = await loginUser(
      { email: 'admin@physiobook.local', password: 'ChangeMe123!' },
      { ...dependencies, now: () => openedAt },
    );

    const { token } = await refreshAt(admin.refreshToken, withinTheWindow);

    expect(verifyAccessToken(token, JWT_SECRET, { now: () => withinTheWindow }).role).toBe('admin');
  });

  it('Rotates nothing — the stored secret and the login horizon are untouched', async () => {
    const opened = await openSession();
    const sessionId = sessionIdOf(opened.refreshToken);
    const before = await rowOf(sessionId);

    await refreshAt(opened.refreshToken, withinTheWindow);

    expect(await rowOf(sessionId)).toEqual(before);
  });

  it('Keeps accepting the same cookie, since there is nothing to rotate', async () => {
    const opened = await openSession();

    await refreshAt(opened.refreshToken, withinTheWindow);

    await expect(refreshAt(opened.refreshToken, withinTheWindow)).resolves.toEqual({
      token: expect.any(String),
    });
  });

  describe('Refuses, with one indistinguishable error', () => {
    const expectUnauthorized = async (cookie: string | undefined, now = withinTheWindow) => {
      await expect(refreshAt(cookie, now)).rejects.toBeInstanceOf(UnauthorizedError);
    };

    it('An absent cookie', async () => {
      await expectUnauthorized(undefined);
    });

    it('A value carrying no separator', async () => {
      await expectUnauthorized('not-a-refresh-token');
    });

    it('A value whose secret half is empty', async () => {
      const opened = await openSession();

      await expectUnauthorized(`${sessionIdOf(opened.refreshToken)}.`);
    });

    it('A session id that is not a uuid, rather than letting 22P02 become a 500', async () => {
      await expectUnauthorized('not-a-uuid.some-secret');
    });

    it('A well-formed session id nobody owns', async () => {
      await expectUnauthorized(`${randomUUID()}.some-secret`);
    });

    it('A live session presented with the wrong secret', async () => {
      const opened = await openSession();

      await expectUnauthorized(`${sessionIdOf(opened.refreshToken)}.not-the-secret`);
    });

    it('A revoked session', async () => {
      const opened = await openSession();
      await revokeSession(sessionIdOf(opened.refreshToken), dependencies);

      await expectUnauthorized(opened.refreshToken);
    });

    it('An expired session', async () => {
      const opened = await openSession();

      await expectUnauthorized(opened.refreshToken, pastExpiry);
    });

    it('A session at the exact instant it expires', async () => {
      const opened = await openSession();
      const expiresAt = (await rowOf(sessionIdOf(opened.refreshToken)))!.expiresAt;

      await expectUnauthorized(opened.refreshToken, expiresAt);
    });
  });
});

describe('revokeSession', () => {
  let database: TestDatabase;
  let dependencies: AuthDependencies;

  const openedAt = new Date('2026-08-13T09:00:00Z');
  const loggedOutAt = new Date('2026-08-13T10:00:00Z');
  const loggedOutAgainAt = new Date('2026-08-13T11:00:00Z');

  beforeAll(async () => {
    database = await createTestDatabase();
    dependencies = {
      db: database.db,
      jwtSecret: JWT_SECRET,
      jwtTtlSeconds: JWT_TTL_SECONDS,
      refreshTtlSeconds: REFRESH_TTL_SECONDS,
    };
  });

  afterAll(async () => {
    await database?.drop();
  });

  const openSession = () =>
    registerUser(
      {
        email: `${randomUUID()}@example.com`,
        password: 'correct-horse-battery',
        full_name: 'Ada Lovelace',
      },
      { ...dependencies, now: () => openedAt },
    );

  const revokeAt = (sessionId: string, now: Date) =>
    revokeSession(sessionId, { ...dependencies, now: () => now });

  const revokedAtOf = async (sessionId: string) => {
    const [row] = await database.db.select().from(sessions).where(eq(sessions.id, sessionId));

    return row?.revokedAt;
  };

  it('Stamps the session from the injected clock', async () => {
    const opened = await openSession();
    const sessionId = parseRefreshToken(opened.refreshToken)!.sessionId;

    await revokeAt(sessionId, loggedOutAt);

    expect(await revokedAtOf(sessionId)).toEqual(loggedOutAt);
  });

  it('Does not move the stamp when the same session is revoked twice', async () => {
    const opened = await openSession();
    const sessionId = parseRefreshToken(opened.refreshToken)!.sessionId;

    await revokeAt(sessionId, loggedOutAt);
    await revokeAt(sessionId, loggedOutAgainAt);

    expect(await revokedAtOf(sessionId)).toEqual(loggedOutAt);
  });

  it("Leaves the account's other sessions live", async () => {
    const first = await openSession();
    const second = await loginUser(
      { email: first.user.email, password: 'correct-horse-battery' },
      { ...dependencies, now: () => openedAt },
    );

    await revokeAt(parseRefreshToken(first.refreshToken)!.sessionId, loggedOutAt);

    expect(await revokedAtOf(parseRefreshToken(second.refreshToken)!.sessionId)).toBeNull();
  });

  it('Is a no-op for a session id nobody owns', async () => {
    await expect(revokeAt(randomUUID(), loggedOutAt)).resolves.toBeUndefined();
  });
});
