import { users, type Database } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AlreadyCancelledError,
  NotFoundError,
  TimeOffConflictError,
  TimeOffInPastError,
} from '../../lib/errors.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';

import { cancelTimeOff, createTimeOff } from './time-off.service.js';

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

  // The real client, except that each insert first takes the next of `failures`
  // as a rejection; reads and later inserts reach Postgres untouched.
  const withFailingInserts = (...failures: unknown[]) => {
    const pending = [...failures];
    const counts = { inserts: 0 };
    const db = new Proxy(database.db, {
      get(target, property, receiver) {
        if (property !== 'insert') return Reflect.get(target, property, receiver);

        counts.inserts += 1;
        if (pending.length === 0) return Reflect.get(target, property, receiver);

        const failure = pending.shift();
        return () => ({ values: () => ({ returning: () => Promise.reject(failure) }) });
      },
    });
    return { db, counts };
  };

  const createWith = (db: Database, start: string, end: string) =>
    createTimeOff(practitionerId, { start, end }, { db, now: () => NOW });

  const overlapViolation = () =>
    Object.assign(new Error('conflicting key value violates exclusion constraint'), {
      code: '23P01',
      constraint: 'calendar_blocks_no_overlap',
    });

  const cancel = (id: string, now = NOW, practitioner = practitionerId) =>
    cancelTimeOff(practitioner, id, { db: database.db, now: () => now });

  const statusOf = async (id: string) => {
    const { rows } = await database.pool.query<{ status: string }>(
      'SELECT status FROM calendar_blocks WHERE id = $1',
      [id],
    );
    return rows[0]?.status;
  };

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

  describe('when the blockers vanish before the conflict read', () => {
    it('Retries once and books the range', async () => {
      const { db, counts } = withFailingInserts(overlapViolation());

      const created = await createWith(db, at('09:00'), at('12:00'));

      expect(counts.inserts).toBe(2);
      expect(await statusOf(created.id)).toBe('active');
    });

    it('Gives up after the retry with a conflict naming nothing', async () => {
      const { db, counts } = withFailingInserts(overlapViolation(), overlapViolation());

      expect(await conflictsOf(createWith(db, at('09:00'), at('12:00')))).toEqual([]);
      expect(counts.inserts).toBe(2);
    });

    it('Does not retry when the conflict read names a blocker', async () => {
      await insertBlock(at('10:00'), at('11:00'));
      const { db, counts } = withFailingInserts();

      await conflictsOf(createWith(db, at('09:00'), at('12:00')));

      expect(counts.inserts).toBe(1);
    });
  });

  describe('cancelTimeOff', () => {
    it('Flips an active time-off to cancelled, freeing its range for a new block', async () => {
      const { id } = await create(at('09:00'), at('12:00'));

      await cancel(id);

      expect(await statusOf(id)).toBe('cancelled');
      await expect(insertBlock(at('10:00'), at('11:00'))).resolves.toBeDefined();
    });

    it('Cancels a time-off that has started but not ended', async () => {
      const { id } = await create(at('09:00'), at('12:00'));

      await expect(cancel(id, new Date(at('11:59')))).resolves.toBeUndefined();
      expect(await statusOf(id)).toBe('cancelled');
    });

    it('Refuses a time-off that is already over and leaves it active', async () => {
      const { id } = await create(at('09:00'), at('12:00'));

      await expect(cancel(id, new Date(at('12:00')))).rejects.toBeInstanceOf(TimeOffInPastError);
      expect(await statusOf(id)).toBe('active');
    });

    it.each(['cancelled', 'cancelled_by_admin'] as const)(
      'Refuses a %s time-off as already cancelled',
      async (status) => {
        const id = await insertBlock(at('09:00'), at('12:00'), { kind: 'time_off', status });

        await expect(cancel(id)).rejects.toBeInstanceOf(AlreadyCancelledError);
      },
    );

    it('Answers not found for an id that does not exist', async () => {
      await expect(cancel('11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('Answers not found for an appointment block and leaves it active', async () => {
      const appointment = await insertBlock(at('10:00'), at('11:00'));

      await expect(cancel(appointment)).rejects.toBeInstanceOf(NotFoundError);
      expect(await statusOf(appointment)).toBe('active');
    });

    it('Answers not found for the time-off of another practitioner', async () => {
      const [other] = await database.db
        .insert(users)
        .values({ email: 'third@example.com', passwordHash: 'x', fullName: 'Third Physio' })
        .returning({ id: users.id });
      const id = await insertBlock(at('09:00'), at('12:00'), {
        kind: 'time_off',
        practitioner: other!.id,
      });

      await expect(cancel(id)).rejects.toBeInstanceOf(NotFoundError);
      expect(await statusOf(id)).toBe('active');
    });

    it('Lets exactly one of several concurrent cancels succeed', async () => {
      const { id } = await create(at('09:00'), at('12:00'));

      const results = await Promise.allSettled(Array.from({ length: 6 }, () => cancel(id)));

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(
        results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
      ).toEqual(Array.from({ length: 5 }, () => expect.any(AlreadyCancelledError)));
    });
  });
});
