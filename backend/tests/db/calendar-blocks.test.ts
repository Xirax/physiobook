import { users } from '@physiobook/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/test-db.js';

const NO_OVERLAP = { code: '23P01', constraint: 'calendar_blocks_no_overlap' };
const ON_THE_HOUR = { code: '23514', constraint: 'calendar_blocks_appointment_on_the_hour' };
const BOUNDED = { code: '23514', constraint: 'calendar_blocks_period_bounded' };
const NOTE_TIME_OFF_ONLY = { code: '23514', constraint: 'calendar_blocks_note_time_off_only' };

const at = (time: string) => `2026-03-02T${time}:00Z`;

describe('calendar_blocks and appointments', () => {
  let database: TestDatabase;
  let practitionerId: string;
  let patientId: string;

  beforeAll(async () => {
    database = await createTestDatabase();

    const [admin] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));
    practitionerId = admin!.id;

    const [patient] = await database.db
      .insert(users)
      .values({ email: 'patient@example.com', passwordHash: 'not-a-real-hash', fullName: 'Pat' })
      .returning({ id: users.id });
    patientId = patient!.id;
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE calendar_blocks CASCADE');
  });

  afterAll(async () => {
    await database?.drop();
  });

  interface BlockOptions {
    kind?: 'appointment' | 'time_off';
    status?: 'active' | 'cancelled' | 'cancelled_by_admin';
    practitioner?: string;
    bounds?: string;
    note?: string;
  }

  const insertBlock = async (start: string, end: string | null, options: BlockOptions = {}) => {
    const { rows } = await database.pool.query<{ id: string }>(
      `INSERT INTO calendar_blocks (practitioner_id, kind, status, period, note)
       VALUES ($1, $2, $3, tstzrange($4, $5, $6), $7)
       RETURNING id`,
      [
        options.practitioner ?? practitionerId,
        options.kind ?? 'appointment',
        options.status ?? 'active',
        start,
        end,
        options.bounds ?? '[)',
        options.note ?? null,
      ],
    );
    return rows[0]!.id;
  };

  const insertAppointment = (blockId: string, userId: string | null = patientId) =>
    database.pool.query('INSERT INTO appointments (block_id, user_id) VALUES ($1, $2)', [
      blockId,
      userId,
    ]);

  describe('no-overlap EXCLUDE constraint', () => {
    it('Rejects a second active block over the same hour', async () => {
      await insertBlock(at('10:00'), at('11:00'));

      await expect(insertBlock(at('10:00'), at('11:00'))).rejects.toMatchObject(NO_OVERLAP);
    });

    it('Rejects an appointment inside an active time-off', async () => {
      await insertBlock(at('09:00'), at('13:00'), { kind: 'time_off' });

      await expect(insertBlock(at('11:00'), at('12:00'))).rejects.toMatchObject(NO_OVERLAP);
    });

    it('Rejects a time-off that partially overlaps an active appointment', async () => {
      await insertBlock(at('10:00'), at('11:00'));

      await expect(
        insertBlock(at('10:30'), at('14:00'), { kind: 'time_off' }),
      ).rejects.toMatchObject(NO_OVERLAP);
    });

    it('Accepts adjacent [10,11) and [11,12) blocks, which only touch', async () => {
      await insertBlock(at('10:00'), at('11:00'));

      await expect(insertBlock(at('11:00'), at('12:00'))).resolves.toBeDefined();
    });

    it.each(['cancelled', 'cancelled_by_admin'] as const)(
      'Lets a new active block take the hour of a %s one',
      async (status) => {
        await insertBlock(at('10:00'), at('11:00'), { status });

        await expect(insertBlock(at('10:00'), at('11:00'))).resolves.toBeDefined();
      },
    );

    it('Refuses to reactivate a cancelled block whose hour was taken since', async () => {
      const cancelled = await insertBlock(at('10:00'), at('11:00'), { status: 'cancelled' });
      await insertBlock(at('10:00'), at('11:00'));

      await expect(
        database.pool.query(`UPDATE calendar_blocks SET status = 'active' WHERE id = $1`, [
          cancelled,
        ]),
      ).rejects.toMatchObject(NO_OVERLAP);
    });

    it('Scopes overlap to one practitioner', async () => {
      const [other] = await database.db
        .insert(users)
        .values({ email: 'other@example.com', passwordHash: 'x', fullName: 'Other Physio' })
        .returning({ id: users.id });
      await insertBlock(at('10:00'), at('11:00'));

      await expect(
        insertBlock(at('10:00'), at('11:00'), { practitioner: other!.id }),
      ).resolves.toBeDefined();
    });

    it('Lets exactly one of several concurrent bookings for the same hour win', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => insertBlock(at('15:00'), at('16:00'))),
      );

      const rejected = results.filter((result) => result.status === 'rejected');
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(rejected.map((result) => result.reason)).toEqual(
        Array.from({ length: 9 }, () => expect.objectContaining(NO_OVERLAP)),
      );
    });
  });

  describe('ON CONFLICT arbiters', () => {
    // Booking and time off insert with a targetless ON CONFLICT DO NOTHING and
    // read "no row" as an overlap (SCHEMA.md 2.5). A new unique or exclusion
    // index here would be absorbed the same way and come back as SLOT_TAKEN /
    // TIME_OFF_CONFLICT, so adding one must revisit that decision first.
    it('Has only the primary key and the no-overlap EXCLUDE as unique or exclusion indexes', async () => {
      const { rows } = await database.pool.query<{ name: string }>(
        `SELECT index_class.relname AS name
           FROM pg_index
           JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
          WHERE pg_index.indrelid = 'calendar_blocks'::regclass
            AND (pg_index.indisunique OR pg_index.indisexclusion)
          ORDER BY name`,
      );

      expect(rows.map(({ name }) => name)).toEqual([
        'calendar_blocks_no_overlap',
        'calendar_blocks_pkey',
      ]);
    });
  });

  describe('period shape', () => {
    it.each([
      ['off the hour (10:30)', at('10:30'), at('11:30')],
      ['two hours long', at('10:00'), at('12:00')],
      ['half an hour long', at('10:00'), at('10:30')],
    ])('Rejects an appointment %s', async (_, start, end) => {
      await expect(insertBlock(start, end)).rejects.toMatchObject(ON_THE_HOUR);
    });

    it('Checks the hour in UTC, not the session timezone', async () => {
      const client = await database.pool.connect();
      try {
        await client.query(`SET TIME ZONE 'Asia/Kolkata'`);

        await expect(
          client.query(
            `INSERT INTO calendar_blocks (practitioner_id, kind, period)
             VALUES ($1, 'appointment', tstzrange('2026-03-02 10:00+05:30', '2026-03-02 11:00+05:30', '[)'))`,
            [practitionerId],
          ),
        ).rejects.toMatchObject(ON_THE_HOUR);
      } finally {
        client.release(true);
      }
    });

    it('Accepts a time-off over an arbitrary range', async () => {
      await expect(
        insertBlock(at('10:15'), '2026-03-04T13:40:00Z', { kind: 'time_off' }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['empty', at('10:00'), at('10:00'), '[)'],
      ['unbounded', at('10:00'), null, '[)'],
      ['not [) bounded', at('10:00'), at('12:00'), '(]'],
    ])('Rejects an %s time-off period', async (_, start, end, bounds) => {
      await expect(insertBlock(start, end, { kind: 'time_off', bounds })).rejects.toMatchObject(
        BOUNDED,
      );
    });

    it('Moves updated_at when a block changes', async () => {
      const id = await insertBlock(at('10:00'), at('11:00'));

      await database.pool.query(`UPDATE calendar_blocks SET status = 'cancelled' WHERE id = $1`, [
        id,
      ]);

      const { rows } = await database.pool.query<{ moved: boolean }>(
        'SELECT updated_at > created_at AS moved FROM calendar_blocks WHERE id = $1',
        [id],
      );
      expect(rows[0]).toEqual({ moved: true });
    });
  });

  describe('note', () => {
    it('Keeps the note of a time-off block', async () => {
      const id = await insertBlock(at('09:00'), at('13:00'), { kind: 'time_off', note: 'Dentist' });

      const { rows } = await database.pool.query('SELECT note FROM calendar_blocks WHERE id = $1', [
        id,
      ]);
      expect(rows[0]).toEqual({ note: 'Dentist' });
    });

    it('Leaves the note optional on a time-off block', async () => {
      await expect(
        insertBlock(at('09:00'), at('13:00'), { kind: 'time_off' }),
      ).resolves.toBeDefined();
    });

    it('Refuses a note on an appointment block', async () => {
      await expect(
        insertBlock(at('10:00'), at('11:00'), { note: 'Dentist' }),
      ).rejects.toMatchObject(NOTE_TIME_OFF_ONLY);
    });
  });

  describe('appointments', () => {
    it('Links one appointment to its block', async () => {
      const blockId = await insertBlock(at('10:00'), at('11:00'));

      await expect(insertAppointment(blockId)).resolves.toBeDefined();
    });

    it('Refuses a second appointment on the same block', async () => {
      const blockId = await insertBlock(at('10:00'), at('11:00'));
      await insertAppointment(blockId);

      await expect(insertAppointment(blockId)).rejects.toMatchObject({ code: '23505' });
    });

    it('Refuses an appointment for a user that does not exist', async () => {
      const blockId = await insertBlock(at('10:00'), at('11:00'));

      await expect(
        insertAppointment(blockId, '11111111-1111-4111-8111-111111111111'),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('Refuses an appointment with no user', async () => {
      const blockId = await insertBlock(at('10:00'), at('11:00'));

      await expect(insertAppointment(blockId, null)).rejects.toMatchObject({ code: '23502' });
    });

    it('Refuses an appointment on a block that does not exist', async () => {
      await expect(insertAppointment('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject(
        { code: '23503' },
      );
    });

    it('Goes away with its block', async () => {
      const blockId = await insertBlock(at('10:00'), at('11:00'));
      await insertAppointment(blockId);

      await database.pool.query('DELETE FROM calendar_blocks WHERE id = $1', [blockId]);

      const { rowCount } = await database.pool.query('SELECT 1 FROM appointments');
      expect(rowCount).toBe(0);
    });
  });
});
