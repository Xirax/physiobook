import { calendarBlocks, type Database } from '@physiobook/db';
import type { BlockConflict, CreateTimeOffRequest, TimeOff } from '@physiobook/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

import {
  AlreadyCancelledError,
  isPostgresError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
  TimeOffConflictError,
  TimeOffInPastError,
} from '../../lib/errors.js';

export interface TimeOffDependencies {
  db: Database;
  now: () => Date;
}

const startOf = sql`lower(${calendarBlocks.period})`.mapWith(calendarBlocks.createdAt);
const endOf = sql`upper(${calendarBlocks.period})`.mapWith(calendarBlocks.createdAt);

const periodOf = ({ start, end }: { start: string; end: string }) =>
  sql`tstzrange(${start}, ${end}, '[)')`;

async function findConflicts(
  db: Database,
  practitionerId: string,
  range: CreateTimeOffRequest,
): Promise<BlockConflict[]> {
  const rows = await db
    .select({ id: calendarBlocks.id, kind: calendarBlocks.kind, start: startOf, end: endOf })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.practitionerId, practitionerId),
        eq(calendarBlocks.status, 'active'),
        sql`${calendarBlocks.period} && ${periodOf(range)}`,
      ),
    )
    .orderBy(asc(startOf));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
  }));
}

export async function createTimeOff(
  practitionerId: string,
  input: CreateTimeOffRequest,
  { db, now }: TimeOffDependencies,
): Promise<TimeOff> {
  if (Date.parse(input.end) <= now().getTime()) throw new TimeOffInPastError();

  try {
    const [row] = await db
      .insert(calendarBlocks)
      .values({
        practitionerId,
        kind: 'time_off',
        period: periodOf(input),
        note: input.note ?? null,
      })
      .returning({ id: calendarBlocks.id, start: startOf, end: endOf, note: calendarBlocks.note });

    if (row === undefined) throw new Error('time-off insert returned no row');

    return {
      id: row.id,
      start: row.start.toISOString(),
      end: row.end.toISOString(),
      note: row.note,
    };
  } catch (error) {
    if (!isPostgresError(error, PG_EXCLUSION_VIOLATION, 'calendar_blocks_no_overlap')) throw error;

    // The constraint has already decided; this read only names the winners. A
    // blocker cancelled in between can make the list shorter, never the 409 wrong.
    throw new TimeOffConflictError(await findConflicts(db, practitionerId, input));
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
  const notYetOver = sql`${endOf} > ${now().toISOString()}::timestamptz`;

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
