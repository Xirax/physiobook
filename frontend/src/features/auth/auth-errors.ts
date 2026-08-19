import { errorCodes } from '@physiobook/shared';

import { ApiError } from '../../lib/api-client';

const BY_CODE: Record<string, string> = {
  [errorCodes.INVALID_CREDENTIALS]: 'That email and password do not match an account.',
  [errorCodes.EMAIL_TAKEN]: 'An account already exists for that email. Try logging in instead.',
  [errorCodes.VALIDATION_FAILED]: 'Check the highlighted fields and try again.',
  [errorCodes.RATE_LIMITED]: 'Too many attempts. Wait a minute, then try again.',
};

/**
 * The sentence shown above an auth form when a submit is refused.
 *
 * Keyed on `code` rather than on the API's `message` (FRONTEND_DEV.md §2): the
 * message is prose the backend may reword, the code is the contract.
 */
export function describeAuthError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'We could not reach the server. Check your connection and try again.';
  }

  return BY_CODE[error.code] ?? 'Something went wrong on our end. Try again in a moment.';
}
