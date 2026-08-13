import { randomUUID } from 'node:crypto';

import { sessions, users, type Database } from '@physiobook/db';
import type {
  LoginRequest,
  PublicUser,
  RefreshResponse,
  RegisterRequest,
  UserRole,
} from '@physiobook/shared';
import bcrypt from 'bcrypt';
import { and, eq, isNull } from 'drizzle-orm';

import {
  EmailTakenError,
  findDatabaseError,
  InvalidCredentialsError,
  isPostgresError,
  PG_UNIQUE_VIOLATION,
  UnauthorizedError,
} from '../../lib/errors.js';
import {
  mintRefreshToken,
  parseRefreshToken,
  refreshSecretMatches,
} from '../../lib/refresh-token.js';
import { signAccessToken } from '../../lib/tokens.js';

export const BCRYPT_COST = 12;
const EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';

export const DUMMY_PASSWORD_HASH = '$2b$12$P1lKSS4zskA.fVALxfV6IORLjMC8z3Gy/nE/ylcBsF75jvAbXccNG';

export interface LookupDependencies {
  db: Database;
}

export interface RevokeDependencies extends LookupDependencies {
  now?: () => Date;
}

export interface RefreshDependencies extends RevokeDependencies {
  jwtSecret: string;
  jwtTtlSeconds: number;
}

export interface AuthDependencies extends RefreshDependencies {
  refreshTtlSeconds: number;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  refreshToken: string;
  refreshTtlSeconds: number;
}

const publicColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  createdAt: users.createdAt,
} as const;

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  createdAt: Date;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    full_name: row.fullName,
    role: row.role,
    created_at: row.createdAt.toISOString(),
  };
}

async function startSession(
  row: UserRow,
  { db, jwtSecret, jwtTtlSeconds, refreshTtlSeconds, now = () => new Date() }: AuthDependencies,
): Promise<AuthResult> {
  const issuedAt = now();
  const sessionId = randomUUID();
  const refreshToken = mintRefreshToken(sessionId);

  await db.insert(sessions).values({
    id: sessionId,
    userId: row.id,
    tokenHash: refreshToken.hash,
    expiresAt: new Date(issuedAt.getTime() + refreshTtlSeconds * 1000),
  });

  return {
    user: toPublicUser(row),
    token: signAccessToken(
      { id: row.id, role: row.role, sessionId },
      { secret: jwtSecret, ttlSeconds: jwtTtlSeconds, now: () => issuedAt },
    ),
    refreshToken: refreshToken.value,
    refreshTtlSeconds,
  };
}

export async function registerUser(
  input: RegisterRequest,
  dependencies: AuthDependencies,
): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  let created;
  try {
    const inserted = await dependencies.db
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        fullName: input.full_name,
        role: 'user',
      })
      .returning(publicColumns);

    created = inserted[0];
  } catch (error) {
    if (isPostgresError(error, PG_UNIQUE_VIOLATION, EMAIL_UNIQUE_CONSTRAINT)) {
      throw new EmailTakenError();
    }

    const databaseError = findDatabaseError(error);
    throw databaseError === undefined ? error : databaseError.cause;
  }

  if (created === undefined) {
    throw new Error('Insert returned no row');
  }

  return startSession(created, dependencies);
}

export async function loginUser(
  input: LoginRequest,
  dependencies: AuthDependencies,
): Promise<AuthResult> {
  const [found] = await dependencies.db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  const matches = await bcrypt.compare(input.password, found?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (found === undefined || !matches) {
    throw new InvalidCredentialsError();
  }

  const { passwordHash: _hash, ...row } = found;

  return startSession(row, dependencies);
}

export async function findUserById(
  userId: string,
  { db }: LookupDependencies,
): Promise<PublicUser> {
  const [row] = await db.select(publicColumns).from(users).where(eq(users.id, userId)).limit(1);

  // The guard already proved a live session, and sessions cascade with their
  // user — so a missing row means the account was deleted mid-request. That is
  // a dead credential, not a 404.
  if (row === undefined) throw new UnauthorizedError();

  return toPublicUser(row);
}

export async function refreshSession(
  cookie: string | undefined,
  { db, jwtSecret, jwtTtlSeconds, now = () => new Date() }: RefreshDependencies,
): Promise<RefreshResponse> {
  const presented = cookie === undefined ? undefined : parseRefreshToken(cookie);
  if (presented === undefined) throw new UnauthorizedError();

  const at = now();

  const [session] = await db
    .select({
      id: sessions.id,
      tokenHash: sessions.tokenHash,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userId: users.id,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, presented.sessionId))
    .limit(1);

  if (session === undefined) throw new UnauthorizedError();

  const live =
    refreshSecretMatches(presented.secret, session.tokenHash) &&
    session.revokedAt === null &&
    session.expiresAt > at;

  if (!live) throw new UnauthorizedError();

  return {
    token: signAccessToken(
      { id: session.userId, role: session.role, sessionId: session.id },
      { secret: jwtSecret, ttlSeconds: jwtTtlSeconds, now: () => at },
    ),
  };
}

export async function revokeSession(
  sessionId: string,
  { db, now = () => new Date() }: RevokeDependencies,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}
