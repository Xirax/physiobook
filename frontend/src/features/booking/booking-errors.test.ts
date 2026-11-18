import { errorCodes } from '@physiobook/shared';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { describeBookingError } from './booking-errors';

const refusal = (status: number, code: string) => new ApiError(status, { code, message: code });

describe('describeBookingError', () => {
  it('Tells a patient who lost the race that the slot was just taken', () => {
    expect(describeBookingError(refusal(409, errorCodes.SLOT_TAKEN))).toBe(
      'Someone else has just booked that slot. The list is up to date again — pick another time.',
    );
  });

  it('Says when the slot can no longer be booked', () => {
    expect(describeBookingError(refusal(422, errorCodes.SLOT_NOT_BOOKABLE))).toBe(
      'That slot can no longer be booked. The list is up to date again — pick another time.',
    );
  });

  it('Asks the patient to wait when the booking rate limit is hit', () => {
    expect(describeBookingError(refusal(429, errorCodes.RATE_LIMITED))).toBe(
      'Too many booking attempts. Wait a minute, then try again.',
    );
  });

  it('Falls back to a generic message for a code it does not name', () => {
    expect(describeBookingError(refusal(500, errorCodes.INTERNAL_ERROR))).toBe(
      'Something went wrong on our end. Nothing was booked — try again.',
    );
  });

  it('Blames the connection when the API never answered', () => {
    expect(describeBookingError(new TypeError('Failed to fetch'))).toBe(
      'We could not reach the server. Nothing was booked — try again.',
    );
  });
});
