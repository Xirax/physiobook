import { errorCodes, type ErrorCode } from '@physiobook/shared';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class EmailTakenError extends DomainError {
  constructor() {
    super(errorCodes.EMAIL_TAKEN, 409, 'That email address is already registered');
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export const PG_UNIQUE_VIOLATION = '23505';

export function findDatabaseError(
  error: unknown,
): { code: string; constraint?: string; cause: unknown } | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 10; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;

    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };

    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === 'string' ? { constraint: candidate.constraint } : {}),
        cause: current,
      };
    }

    current = candidate.cause;
  }

  return undefined;
}

export function isPostgresError(error: unknown, code: string, constraint?: string): boolean {
  const found = findDatabaseError(error);

  if (found === undefined || found.code !== code) return false;
  if (constraint === undefined) return true;

  return found.constraint === constraint;
}
