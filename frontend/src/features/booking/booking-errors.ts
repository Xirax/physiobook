import { errorCodes } from '@physiobook/shared';

import { ApiError } from '../../lib/api-client';

const BY_CODE: Record<string, string> = {
  [errorCodes.SLOT_TAKEN]:
    'Someone else has just booked that slot. The list is up to date again — pick another time.',
  [errorCodes.SLOT_NOT_BOOKABLE]:
    'That slot can no longer be booked. The list is up to date again — pick another time.',
  [errorCodes.RATE_LIMITED]: 'Too many booking attempts. Wait a minute, then try again.',
};

export function describeBookingError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'We could not reach the server. Nothing was booked — try again.';
  }

  return BY_CODE[error.code] ?? 'Something went wrong on our end. Nothing was booked — try again.';
}
