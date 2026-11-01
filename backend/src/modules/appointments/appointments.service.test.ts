import { randomUUID } from 'node:crypto';

import { appointments, calendarBlocks, users, type Database } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SlotNotBookableError, SlotTakenError } from '../../lib/errors.js';
import { createTestDatabase, type TestDatabase } from '../../../tests/helpers/test-db.js';
import { replaceBusinessHours } from '../availability/business-hours.service.js';
import { updateSettings } from '../settings/settings.service.js';

import { bookAppointment } from './appointments.service.js';

// A Sunday; 2026-11-02 is the Monday after, on CET (UTC+1), so the 09:00-13:00
// Warsaw window is 08:00-12:00Z.
const NOW = new Date('2026-11-01T12:00:00Z');

const at = (time: string) => `2026-11-02T${time}:00.000Z`;

const MONDAY_9_TO_13 = { windows: [{ day_of_week: 1, opens_at: '09:00', closes_at: '13:00' }] };

describe('appointments service', () => {
  let database: TestDatabase;
  let practitionerId: string;
  let patientId: string;

  const setTimezone = (timezone: string) =>
    updateSettings(
      { timezone, reminder_lead_hours: 24, cancellation_cutoff_hours: 24 },
      { db: database.db },
    );

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

  // The real client, except that inside a transaction an insert into `table`
  // returns no row; every other query reaches Postgres untouched.
  const withEmptyInsertInto = (table: typeof calendarBlocks | typeof appointments): Database =>
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
                    into === table
                      ? { values: () => ({ returning: () => Promise.resolve([]) }) }
                      : txTarget.insert(into as typeof table);
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

  it.each([
    ['calendar block', calendarBlocks, 'calendar block insert returned no row'],
    ['appointment', appointments, 'appointment insert returned no row'],
  ] as const)('Fails loudly when the %s insert returns no row', async (_, table, message) => {
    await expect(book(at('10:00'), { db: withEmptyInsertInto(table) })).rejects.toThrow(message);

    expect(await countOf('calendar_blocks')).toBe(0);
  });
});
