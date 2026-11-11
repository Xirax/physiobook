import { errorCodes, type BlockConflict, type ErrorCode } from '@physiobook/shared';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** Extra top-level fields for the response body; the route's schema must declare them. */
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    extensions: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.extensions = extensions;
  }
}

export class EmailTakenError extends DomainError {
  constructor() {
    super(errorCodes.EMAIL_TAKEN, 409, 'That email address is already registered');
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super(errorCodes.INVALID_CREDENTIALS, 401, 'Invalid email or password');
  }
}

export class UnauthorizedError extends DomainError {
  constructor() {
    super(errorCodes.UNAUTHORIZED, 401, 'Authentication required');
  }
}

export class ForbiddenError extends DomainError {
  constructor() {
    super(errorCodes.FORBIDDEN, 403, 'You do not have access to this resource');
  }
}

export class RateLimitedError extends DomainError {
  constructor(retryAfter: string) {
    super(errorCodes.RATE_LIMITED, 429, `Too many requests. Try again in ${retryAfter}.`);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(errorCodes.NOT_FOUND, 404, message);
  }
}

export class AlreadyCancelledError extends DomainError {
  constructor(message: string) {
    super(errorCodes.ALREADY_CANCELLED, 409, message);
  }
}

export class TimeOffConflictError extends DomainError {
  constructor(conflicts: BlockConflict[]) {
    super(errorCodes.TIME_OFF_CONFLICT, 409, 'That time overlaps booked appointments or time off', {
      conflicts,
    });
  }
}

export class TimeOffInPastError extends DomainError {
  constructor() {
    super(errorCodes.TIME_OFF_IN_PAST, 422, 'That time off is already over');
  }
}

export class SlotTakenError extends DomainError {
  constructor() {
    super(errorCodes.SLOT_TAKEN, 409, 'That slot has just been taken. Pick another time.');
  }
}

export class SlotNotBookableError extends DomainError {
  constructor() {
    super(errorCodes.SLOT_NOT_BOOKABLE, 422, 'That time is not a bookable slot');
  }
}

export class CancellationCutoffPassedError extends DomainError {
  constructor(cutoffHours: number) {
    super(
      errorCodes.CANCELLATION_CUTOFF_PASSED,
      422,
      `Appointments can only be cancelled at least ${cutoffHours}h in advance`,
    );
  }
}

export class AppointmentAlreadyStartedError extends DomainError {
  constructor() {
    super(errorCodes.APPOINTMENT_ALREADY_STARTED, 422, 'That appointment has already started');
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
