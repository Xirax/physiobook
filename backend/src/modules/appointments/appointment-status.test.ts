import { blockStatus } from '@physiobook/db';
import { appointmentStatusSchema, type AppointmentStatus } from '@physiobook/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';

// The contract's status enum mirrors the block_status column it is read from.
describe('appointment status', () => {
  it('Lists exactly the block_status values', () => {
    expect(appointmentStatusSchema.options).toEqual(blockStatus.enumValues);
  });

  it('Has the same type as a block_status value', () => {
    expectTypeOf<AppointmentStatus>().toEqualTypeOf<(typeof blockStatus.enumValues)[number]>();
  });
});
