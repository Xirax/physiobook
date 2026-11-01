import { errorCodes } from '@physiobook/shared';

import { ApiError } from '../../lib/api-client';

const BY_CODE: Record<string, string> = {
  [errorCodes.VALIDATION_FAILED]: 'The server refused these values. Check them and try again.',
  [errorCodes.FORBIDDEN]: 'Only the practice admin can change this.',
};

export function describeSaveError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'We could not reach the server. Nothing was saved — try again.';
  }

  return BY_CODE[error.code] ?? 'Something went wrong on our end. Nothing was saved — try again.';
}
