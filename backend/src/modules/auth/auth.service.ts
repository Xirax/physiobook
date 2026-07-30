import { users, type Database } from '@physiobook/db';
import type { AuthResponse, PublicUser, RegisterRequest } from '@physiobook/shared';
import bcrypt from 'bcrypt';

import {
  EmailTakenError,
  findDatabaseError,
  isPostgresError,
  PG_UNIQUE_VIOLATION,
} from '../../lib/errors.js';
import { signAccessToken } from '../../lib/tokens.js';

export const BCRYPT_COST = 12;
const EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';

export interface RegisterDependencies {
  db: Database;
  jwtSecret: string;
  jwtTtlSeconds: number;
  now?: () => Date;
}

const publicColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  createdAt: users.createdAt,
} as const;

function toPublicUser(row: {
  id: string;
  email: string;
  fullName: string;
  role: 'user' | 'admin';
  createdAt: Date;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    full_name: row.fullName,
    role: row.role,
    created_at: row.createdAt.toISOString(),
  };
}

export async function registerUser(
  input: RegisterRequest,
  { db, jwtSecret, jwtTtlSeconds, now }: RegisterDependencies,
): Promise<AuthResponse> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  let created;
  try {
    const inserted = await db
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

  const user = toPublicUser(created);

  return {
    user,
    token: signAccessToken(
      { id: user.id, role: user.role },
      {
        secret: jwtSecret,
        ttlSeconds: jwtTtlSeconds,
        ...(now === undefined ? {} : { now }),
      },
    ),
  };
}
