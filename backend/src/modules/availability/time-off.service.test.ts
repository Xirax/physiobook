import { users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TimeOffConflictError, TimeOffInPastError } from '../../lib/errors.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

import { createTimeOff } from './time-off.service.js';

const NOW = new Date('2026-11-01T12:00:00Z');

const at = (time: string) => `2026-11-02T${time}:00.000Z`;

describe('time-off service', () => {
  let database: TestDatabase;
  let practitionerId: string;

  const create = (start: string, end: string, note?: string, now = NOW) =>
    createTimeOff(
      practitionerId,
      { start, end, ...(note === undefined ? {} : { note }) },
      { db: database.db, now: () => now },
    );

  interface BlockOptions {
    kind?: 'appointment' | 'time_off';
    status?: 'active' | 'cancelled' | 'cancelled_by_admin';
    practitioner?: string;
  }

  const insertBlock = async (start: string, end: string, options: BlockOptions = {}) => {
    const { rows } = await database.pool.query<{ id: string }>(
      `INSERT INTO calendar_blocks (practitioner_id, kind, status, period)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'))
       RETURNING id`,
      [
        options.practitioner ?? practitionerId,
        options.kind ?? 'appointment',
        options.status ?? 'active',
        start,
        end,
      ],
    );
    return rows[0]!.id;
  };

  const conflictsOf = async (attempt: Promise<unknown>) => {
    const error: unknown = await attempt.then(
      () => expect.fail('expected a TimeOffConflictError'),
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TimeOffConflictError);
    return (error as TimeOffConflictError).extensions['conflicts'];
  };

  beforeAll(async () => {
    database = await createTestDatabase();

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    practitionerId = admin!.id;
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await database?.drop();
  });

  it('Books a free range as an active time-off block with its note', async () => {
    const created = await create(at('09:15'), at('13:40'), 'Dentist');

    expect(created).toEqual({
      id: expect.any(String),
      start: at('09:15'),
      end: at('13:40'),
      note: 'Dentist',
    });

    const { rows } = await database.pool.query(
      'SELECT practitioner_id, kind, status, note FROM calendar_blocks WHERE id = $1',
      [created.id],
    );
    expect(rows[0]).toEqual({
      practitioner_id: practitionerId,
      kind: 'time_off',
      status: 'active',
      note: 'Dentist',
    });
  });

  it('Stores a missing note as null', async () => {
    expect((await create(at('09:00'), at('10:00'))).note).toBeNull();
  });

  it('Lists the appointment a range overlaps', async () => {
    const appointment = await insertBlock(at('10:00'), at('11:00'));

    expect(await conflictsOf(create(at('09:00'), at('10:30')))).toEqual([
      { id: appointment, kind: 'appointment', start: at('10:00'), end: at('11:00') },
    ]);
  });

  it('Lists the time-off a range overlaps', async () => {
    const existing = await create(at('12:00'), at('14:00'));

    expect(await conflictsOf(create(at('13:00'), at('15:00')))).toEqual([
      { id: existing.id, kind: 'time_off', start: at('12:00'), end: at('14:00') },
    ]);
  });

  it('Lists every block a range spans, earliest first, and nothing outside it', async () => {
    const later = await insertBlock(at('15:00'), at('16:00'));
    const earlier = await insertBlock(at('10:00'), at('11:00'));
    await insertBlock(at('17:00'), at('18:00'));

    expect(await conflictsOf(create(at('08:00'), at('17:00')))).toEqual([
      expect.objectContaining({ id: earlier }),
      expect.objectContaining({ id: later }),
    ]);
  });

  it('Writes nothing when it conflicts', async () => {
    await insertBlock(at('10:00'), at('11:00'));
    await conflictsOf(create(at('09:00'), at('12:00')));

    const { rows } = await database.pool.query(
      `SELECT count(*)::int AS count FROM calendar_blocks WHERE kind = 'time_off'`,
    );
    expect(rows[0]).toEqual({ count: 0 });
  });

  it('Accepts a range that only touches neighbouring blocks', async () => {
    await insertBlock(at('09:00'), at('10:00'));
    await insertBlock(at('12:00'), at('13:00'));

    await expect(create(at('10:00'), at('12:00'))).resolves.toBeDefined();
  });

  it.each(['cancelled', 'cancelled_by_admin'] as const)(
    'Ignores a %s block in the way',
    async (status) => {
      await insertBlock(at('10:00'), at('11:00'), { status });

      await expect(create(at('09:00'), at('12:00'))).resolves.toBeDefined();
    },
  );

  it('Ignores the blocks of another practitioner', async () => {
    const [other] = await database.db
      .insert(users)
      .values({ email: 'other@example.com', passwordHash: 'x', fullName: 'Other Physio' })
      .returning({ id: users.id });
    await insertBlock(at('10:00'), at('11:00'), { practitioner: other!.id });

    await expect(create(at('09:00'), at('12:00'))).resolves.toBeDefined();
  });

  it('Refuses a range that is already over', async () => {
    const attempt = create(at('09:00'), at('10:00'), undefined, new Date(at('10:00')));

    await expect(attempt).rejects.toBeInstanceOf(TimeOffInPastError);
  });

  it('Accepts a range that has started but not ended', async () => {
    const attempt = create(at('09:00'), at('10:00'), undefined, new Date(at('09:59')));

    await expect(attempt).resolves.toBeDefined();
  });

  it('Lets exactly one of several concurrent overlapping requests win', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, hour) => create(at(`0${String(hour)}:30`), at('09:00'))),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
    ).toEqual(Array.from({ length: 7 }, () => expect.any(TimeOffConflictError)));
  });
});
