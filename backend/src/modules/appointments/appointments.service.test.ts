import { randomUUID } from 'node:crypto';

import { appointments, users, type Database } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AlreadyCancelledError,
  CancellationCutoffPassedError,
  ForbiddenError,
  NotFoundError,
  SlotNotBookableError,
  SlotTakenError,
} from '../../lib/errors.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { replaceBusinessHours } from '../availability/business-hours.service.js';
import { updateSettings } from '../settings/settings.service.js';

import { bookAppointment, cancelAppointment } from './appointments.service.js';

// A Sunday; 2026-11-02 is the Monday after, on CET (UTC+1), so the 09:00-13:00
// Warsaw window is 08:00-12:00Z.
const NOW = new Date('2026-11-01T12:00:00Z');

const at = (time: string) => `2026-11-02T${time}:00.000Z`;

const MONDAY_9_TO_13 = { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] };

describe('appointments service', () => {
  let database: TestDatabase;
  let practitionerId: string;
  let patientId: string;

  const setSettings = ({ timezone = 'Europe/Warsaw', cutoffHours = 24 } = {}) =>
    updateSettings(
      { timezone, reminder_lead_hours: 24, cancellation_cutoff_hours: cutoffHours },
      { db: database.db },
    );
  const setTimezone = (timezone: string) => setSettings({ timezone });

  const book = (start: string, { user = patientId, now = NOW, db = database.db } = {}) =>
    bookAppointment(user, { start }, { db, now: () => now });

  interface BlockOptions {
    kind?: 'appointment' | 'time_off';
    status?: 'active' | 'cancelled' | 'cancelled_by_admin';
    practitioner?: string;
  }

  const insertBlock = (start: string, end: string, options: BlockOptions = {}) =>
    database.pool.query(
      `INSERT INTO calendar_blocks (practitioner_id, kind, status, period)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'))`,
      [
        options.practitioner ?? practitionerId,
        options.kind ?? 'appointment',
        options.status ?? 'active',
        start,
        end,
      ],
    );

  const countOf = async (table: 'calendar_blocks' | 'appointments') => {
    const { rows } = await database.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table}`,
    );
    return rows[0]!.count;
  };

  // The real client, except that inside a transaction an insert into
  // `appointments` returns no row; every other query reaches Postgres untouched.
  const withEmptyAppointmentInsert = (): Database =>
    new Proxy(database.db, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver);

        return (run: (tx: Database) => Promise<unknown>) =>
          target.transaction((tx) =>
            run(
              new Proxy(tx as unknown as Database, {
                get(txTarget, txProperty, txReceiver) {
                  if (txProperty !== 'insert') return Reflect.get(txTarget, txProperty, txReceiver);

                  return (into: unknown) =>
                    into === appointments
                      ? { values: () => ({ returning: () => Promise.resolve([]) }) }
                      : txTarget.insert(into as typeof appointments);
                },
              }),
            ),
          );
      },
    });

  beforeAll(async () => {
    database = await createTestDatabase();

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    practitionerId = admin!.id;

    const [patient] = await database.db
      .insert(users)
      .values({ email: 'pat@example.com', passwordHash: 'not-a-real-hash', fullName: 'Pat' })
      .returning({ id: users.id });
    patientId = patient!.id;
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
    await setTimezone('Europe/Warsaw');
    await replaceBusinessHours(MONDAY_9_TO_13, { db: database.db });
  });

  afterAll(async () => {
    await database?.drop();
  });

  it('Books a free slot as an active one-hour appointment block for the user', async () => {
    const booked = await book('2026-11-02T08:00:00Z');

    expect(booked).toEqual({
      id: expect.any(String),
      start: at('08:00'),
      end: at('09:00'),
      status: 'active',
    });

    const { rows } = await database.pool.query(
      `SELECT a.user_id, b.practitioner_id, b.kind, b.status
         FROM appointments a JOIN calendar_blocks b ON b.id = a.block_id
        WHERE a.id = $1`,
      [booked.id],
    );
    expect(rows).toEqual([
      {
        user_id: patientId,
        practitioner_id: practitionerId,
        kind: 'appointment',
        status: 'active',
      },
    ]);
  });

  it('Books back-to-back slots without a false conflict', async () => {
    await book(at('08:00'));

    await expect(book(at('09:00'))).resolves.toMatchObject({ start: at('09:00') });
  });

  it('Rejects a slot that is already booked with SlotTakenError', async () => {
    await book(at('10:00'));

    await expect(book(at('10:00'))).rejects.toBeInstanceOf(SlotTakenError);
  });

  it('Leaves no orphan block or appointment behind a taken slot', async () => {
    await book(at('10:00'));
    await book(at('10:00')).catch(() => undefined);

    expect(await countOf('calendar_blocks')).toBe(1);
    expect(await countOf('appointments')).toBe(1);
  });

  it('Rejects a slot that time off covers with SlotTakenError', async () => {
    await insertBlock(at('09:30'), at('11:15'), { kind: 'time_off' });

    await expect(book(at('10:00'))).rejects.toBeInstanceOf(SlotTakenError);
  });

  it.each(['cancelled', 'cancelled_by_admin'] as const)(
    'Books over a %s appointment',
    async (status) => {
      await insertBlock(at('10:00'), at('11:00'), { status });

      await expect(book(at('10:00'))).resolves.toMatchObject({ status: 'active' });
    },
  );

  it("Ignores another practitioner's block in the same slot", async () => {
    await insertBlock(at('10:00'), at('11:00'), { practitioner: patientId });

    await expect(book(at('10:00'))).resolves.toMatchObject({ start: at('10:00') });
  });

  it.each([
    ['off the hour', at('08:30')],
    ['before opening', at('07:00')],
    ['ending after closing', at('12:00')],
    ['on a closed day', '2026-11-03T08:00:00.000Z'],
    ['in the past', '2026-10-26T08:00:00.000Z'],
    ['at or beyond the 62-day horizon', '2027-01-04T08:00:00.000Z'],
    ['with a fractional second', '2026-11-02T08:00:00.500Z'],
  ])('Rejects a start %s with SlotNotBookableError and writes nothing', async (_, start) => {
    await expect(book(start)).rejects.toBeInstanceOf(SlotNotBookableError);

    expect(await countOf('calendar_blocks')).toBe(0);
  });

  it('Rejects a slot that has already started', async () => {
    await expect(book(at('08:00'), { now: new Date(at('08:00')) })).rejects.toBeInstanceOf(
      SlotNotBookableError,
    );
  });

  it('Reads business hours in the practice timezone', async () => {
    await setTimezone('UTC');

    await expect(book(at('08:00'))).rejects.toBeInstanceOf(SlotNotBookableError);
    await expect(book(at('12:00'))).resolves.toMatchObject({ start: at('12:00') });
  });

  it('Rolls the block back when the appointment insert fails', async () => {
    const error: unknown = await book(at('10:00'), { user: randomUUID() }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SlotTakenError);
    expect(await countOf('calendar_blocks')).toBe(0);
  });

  it('Fails loudly when the appointment insert returns no row, rolling the block back', async () => {
    await expect(book(at('10:00'), { db: withEmptyAppointmentInsert() })).rejects.toThrow(
      'appointment insert returned no row',
    );

    expect(await countOf('calendar_blocks')).toBe(0);
  });

  describe('cancelAppointment', () => {
    const START = at('10:00');
    const hoursBeforeStart = (hours: number) => new Date(Date.parse(START) - hours * 3_600_000);

    let otherPatientId: string;

    const cancel = (
      id: string,
      { user = patientId, now = hoursBeforeStart(25) }: { user?: string; now?: Date } = {},
    ) => cancelAppointment(user, id, { db: database.db, now: () => now });

    const blockStatusOf = async (appointmentId: string) => {
      const { rows } = await database.pool.query<{ status: string }>(
        `SELECT b.status FROM appointments a JOIN calendar_blocks b ON b.id = a.block_id
          WHERE a.id = $1`,
        [appointmentId],
      );
      return rows[0]!.status;
    };

    const setBlockStatus = (appointmentId: string, status: 'cancelled' | 'cancelled_by_admin') =>
      database.pool.query(
        `UPDATE calendar_blocks SET status = $2
          WHERE id = (SELECT block_id FROM appointments WHERE id = $1)`,
        [appointmentId, status],
      );

    beforeAll(async () => {
      const [other] = await database.db
        .insert(users)
        .values({ email: 'otto@example.com', passwordHash: 'not-a-real-hash', fullName: 'Otto' })
        .returning({ id: users.id });
      otherPatientId = other!.id;
    });

    it('Cancels an own appointment beyond the cutoff and returns it as cancelled', async () => {
      const { id } = await book(START);

      await expect(cancel(id)).resolves.toEqual({
        id,
        start: START,
        end: at('11:00'),
        status: 'cancelled',
      });
      expect(await blockStatusOf(id)).toBe('cancelled');
    });

    it('Frees the slot so it can be booked again', async () => {
      const { id } = await book(START);
      await cancel(id);

      await expect(book(START)).resolves.toMatchObject({ start: START, status: 'active' });
    });

    it('Allows a cancel at exactly the cutoff', async () => {
      const { id } = await book(START);

      await expect(cancel(id, { now: hoursBeforeStart(24) })).resolves.toMatchObject({
        status: 'cancelled',
      });
    });

    it.each([
      ['a millisecond inside the cutoff', hoursBeforeStart(24 - 1 / 3_600_000)],
      ['23h before the start', hoursBeforeStart(23)],
      ['after the start', hoursBeforeStart(-2)],
    ])('Rejects a cancel %s and leaves the block active', async (_, now) => {
      const { id } = await book(START);

      await expect(cancel(id, { now })).rejects.toBeInstanceOf(CancellationCutoffPassedError);
      expect(await blockStatusOf(id)).toBe('active');
    });

    it('Reads the cutoff from practice settings', async () => {
      const { id } = await book(START);
      await setSettings({ cutoffHours: 48 });

      await expect(cancel(id, { now: hoursBeforeStart(25) })).rejects.toBeInstanceOf(
        CancellationCutoffPassedError,
      );
      await expect(cancel(id, { now: hoursBeforeStart(48) })).resolves.toMatchObject({
        status: 'cancelled',
      });
    });

    it('Allows a cancel up to the start itself when the cutoff is zero', async () => {
      const { id } = await book(START);
      await setSettings({ cutoffHours: 0 });

      await expect(cancel(id, { now: hoursBeforeStart(-1) })).rejects.toBeInstanceOf(
        CancellationCutoffPassedError,
      );
      await expect(cancel(id, { now: hoursBeforeStart(0) })).resolves.toMatchObject({
        status: 'cancelled',
      });
    });

    it("Forbids cancelling another user's appointment and leaves it active", async () => {
      const { id } = await book(START);

      await expect(cancel(id, { user: otherPatientId })).rejects.toBeInstanceOf(ForbiddenError);
      expect(await blockStatusOf(id)).toBe('active');
    });

    it("Forbids rather than reports the state of another user's cancelled appointment", async () => {
      const { id } = await book(START);
      await cancel(id);

      await expect(cancel(id, { user: otherPatientId })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('Answers NotFoundError for an id that does not exist', async () => {
      await expect(cancel(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    });

    it('Answers NotFoundError for the id of a time-off block', async () => {
      await insertBlock(at('09:00'), at('10:00'), { kind: 'time_off' });
      const { rows } = await database.pool.query<{ id: string }>('SELECT id FROM calendar_blocks');

      await expect(cancel(rows[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each(['cancelled', 'cancelled_by_admin'] as const)(
      'Rejects cancelling a %s appointment with AlreadyCancelledError',
      async (status) => {
        const { id } = await book(START);
        await setBlockStatus(id, status);

        await expect(cancel(id)).rejects.toBeInstanceOf(AlreadyCancelledError);
        expect(await blockStatusOf(id)).toBe(status);
      },
    );

    it("Leaves the same user's other appointments untouched", async () => {
      const { id } = await book(START);
      const { id: otherId } = await book(at('11:00'));

      await cancel(id);

      expect(await blockStatusOf(otherId)).toBe('active');
    });

    it('Lets exactly one of two concurrent cancels succeed', async () => {
      const { id } = await book(START);

      const results = await Promise.allSettled([cancel(id), cancel(id)]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((result) => result.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(AlreadyCancelledError);
    });
  });
});
