import { calendarBlocks, type Database } from '@physiobook/db';
import type { BlockConflict, CreateTimeOffRequest, TimeOff } from '@physiobook/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

import {
  AlreadyCancelledError,
  NotFoundError,
  TimeOffConflictError,
  TimeOffInPastError,
} from '../../lib/errors.js';
import { periodEnd, periodStart, tstzrangeOf } from '../../lib/period.js';

export interface TimeOffDependencies {
  db: Database;
  now: () => Date;
}

async function findConflicts(
  db: Database,
  practitionerId: string,
  range: CreateTimeOffRequest,
): Promise<BlockConflict[]> {
  const rows = await db
    .select({
      id: calendarBlocks.id,
      kind: calendarBlocks.kind,
      start: periodStart,
      end: periodEnd,
    })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.practitionerId, practitionerId),
        eq(calendarBlocks.status, 'active'),
        sql`${calendarBlocks.period} && ${tstzrangeOf(range)}`,
      ),
    )
    .orderBy(asc(periodStart));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
  }));
}

async function insertTimeOff(
  db: Database,
  practitionerId: string,
  input: CreateTimeOffRequest,
): Promise<TimeOff | undefined> {
  const [row] = await db
    .insert(calendarBlocks)
    .values({
      practitionerId,
      kind: 'time_off',
      period: tstzrangeOf(input),
      note: input.note ?? null,
    })
    .onConflictDoNothing()
    .returning({
      id: calendarBlocks.id,
      start: periodStart,
      end: periodEnd,
      note: calendarBlocks.note,
    });

  if (row === undefined) return undefined;

  return {
    id: row.id,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    note: row.note,
  };
}

const INSERT_ATTEMPTS = 2;

export async function createTimeOff(
  practitionerId: string,
  input: CreateTimeOffRequest,
  { db, now }: TimeOffDependencies,
): Promise<TimeOff> {
  if (Date.parse(input.end) <= now().getTime()) throw new TimeOffInPastError();

  // ON CONFLICT DO NOTHING is load-bearing, not style: plain INSERTs racing on
  // the EXCLUDE constraint can deadlock (40P01) and answer 500; speculative
  // insertion cannot. Ticket 3.3's race tests prove it.
  for (let attempt = 1; ; attempt += 1) {
    const created = await insertTimeOff(db, practitionerId, input);
    if (created !== undefined) return created;

    // The constraint has already decided; this read only names the winners.
    // An empty list means every blocker was cancelled in between, so the
    // range may be free now: retry once rather than answer a 409 naming nothing.
    const conflicts = await findConflicts(db, practitionerId, input);
    if (conflicts.length > 0 || attempt === INSERT_ATTEMPTS) {
      throw new TimeOffConflictError(conflicts);
    }
  }
}

export async function cancelTimeOff(
  practitionerId: string,
  id: string,
  { db, now }: TimeOffDependencies,
): Promise<void> {
  const ownTimeOff = and(
    eq(calendarBlocks.id, id),
    eq(calendarBlocks.practitionerId, practitionerId),
    eq(calendarBlocks.kind, 'time_off'),
  );
  const notYetOver = sql`${periodEnd} > ${now().toISOString()}::timestamptz`;

  // One conditional UPDATE, so two concurrent cancels cannot both succeed; the
  // read below only explains a miss.
  const cancelled = await db
    .update(calendarBlocks)
    .set({ status: 'cancelled' })
    .where(and(ownTimeOff, eq(calendarBlocks.status, 'active'), notYetOver))
    .returning({ id: calendarBlocks.id });

  if (cancelled.length > 0) return;

  const [block] = await db
    .select({ status: calendarBlocks.status })
    .from(calendarBlocks)
    .where(ownTimeOff);

  if (block === undefined) throw new NotFoundError('No such time off');
  if (block.status !== 'active')
    throw new AlreadyCancelledError('That time off is already cancelled');

  throw new TimeOffInPastError();
}
