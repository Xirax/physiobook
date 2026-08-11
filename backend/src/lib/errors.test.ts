import { describe, expect, it } from 'vitest';

import {
  DomainError,
  EmailTakenError,
  findDatabaseError,
  InvalidCredentialsError,
  isDomainError,
  isPostgresError,
  PG_UNIQUE_VIOLATION,
  RateLimitedError,
} from './errors.js';

describe('Domain errors', () => {
  it('carries a stable code and status', () => {
    const error = new EmailTakenError();

    expect(error.code).toBe('EMAIL_TAKEN');
    expect(error.statusCode).toBe(409);
    expect(isDomainError(error)).toBe(true);
  });

  it('Does not name the address it rejected', () => {
    expect(new EmailTakenError().message).not.toMatch(/@/);
  });

  it('Reports its own subclass name', () => {
    expect(new EmailTakenError().name).toBe('EmailTakenError');
    expect(new DomainError('INTERNAL_ERROR', 500, 'boom').name).toBe('DomainError');
  });

  it('Answers a failed login with 401 and nothing about which half was wrong', () => {
    const error = new InvalidCredentialsError();

    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.statusCode).toBe(401);
    expect(error.message).not.toMatch(/@|unknown|no such|exist/i);
  });

  it('Answers a tripped rate limit with 429 and how long to wait', () => {
    const error = new RateLimitedError('1 minute');

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.statusCode).toBe(429);
    expect(error.message).toContain('1 minute');
  });

  it('Does not treat an ordinary error as a domain error', () => {
    expect(isDomainError(new Error('boom'))).toBe(false);
    expect(isDomainError('boom')).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });
});

describe('findDatabaseError', () => {
  const driverError = (constraint: string) =>
    Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
      code: PG_UNIQUE_VIOLATION,
      constraint,
    });

  it('Finds an error thrown directly by the driver', () => {
    const found = findDatabaseError(driverError('users_email_unique'));

    expect(found?.code).toBe(PG_UNIQUE_VIOLATION);
    expect(found?.constraint).toBe('users_email_unique');
  });

  it('finds the driver error inside a wrapper', () => {
    const wrapped = Object.assign(new Error('Failed query: insert into "users" ...'), {
      cause: driverError('users_email_unique'),
    });

    expect(findDatabaseError(wrapped)?.constraint).toBe('users_email_unique');
  });

  it('Returns the driver error itself, so a caller can rethrow it in place of the wrapper', () => {
    const driver = driverError('users_email_unique');
    const wrapped = Object.assign(new Error('Failed query: ... params: secret-hash'), {
      cause: driver,
    });

    expect(findDatabaseError(wrapped)?.cause).toBe(driver);
  });

  it('Finds an error nested more than one layer deep', () => {
    const wrapped = Object.assign(new Error('outer'), {
      cause: Object.assign(new Error('middle'), { cause: driverError('users_email_unique') }),
    });

    expect(findDatabaseError(wrapped)?.code).toBe(PG_UNIQUE_VIOLATION);
  });

  it('Gives up rather than looping on a cause cycle', () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;

    expect(findDatabaseError(a)).toBeUndefined();
  });

  it('Returns undefined for things that are not database errors', () => {
    expect(findDatabaseError(new Error('boom'))).toBeUndefined();
    expect(findDatabaseError(undefined)).toBeUndefined();
    expect(findDatabaseError('23505')).toBeUndefined();
  });
});

describe('isPostgresError', () => {
  const uniqueViolation = (constraint: string) =>
    Object.assign(new Error('duplicate key'), { code: PG_UNIQUE_VIOLATION, constraint });

  it('Matches on code and constraint together', () => {
    const error = uniqueViolation('users_email_unique');

    expect(isPostgresError(error, PG_UNIQUE_VIOLATION, 'users_email_unique')).toBe(true);
  });

  it('Matches on code alone when no constraint is named', () => {
    expect(isPostgresError(uniqueViolation('anything'), PG_UNIQUE_VIOLATION)).toBe(true);
  });

  it('Does not match a different constraint with the same code', () => {
    expect(
      isPostgresError(
        uniqueViolation('users_single_admin_idx'),
        PG_UNIQUE_VIOLATION,
        'users_email_unique',
      ),
    ).toBe(false);
  });

  it('Does not match a different code', () => {
    expect(isPostgresError(uniqueViolation('users_email_unique'), '23P01')).toBe(false);
  });

  it('Does not match a non-error', () => {
    expect(isPostgresError(null, PG_UNIQUE_VIOLATION)).toBe(false);
  });
});
