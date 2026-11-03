import { appointments, calendarBlocks, type Database } from '@physiobook/db';
import type { Appointment, BookAppointmentRequest } from '@physiobook/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  AlreadyCancelledError,
  CancellationCutoffPassedError,
  ForbiddenError,
  isPostgresError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
  SlotNotBookableError,
  SlotTakenError,
} from '../../lib/errors.js';
import { periodEnd, periodStart, tstzrangeOf } from '../../lib/period.js';
import { getBusinessHours } from '../availability/business-hours.service.js';
import { isSlotBookable } from '../availability/slot-grid.js';
import { findPractitionerId } from '../practitioner/practitioner.service.js';
import { getSettings } from '../settings/settings.service.js';

export interface AppointmentsDependencies {
  db: Database;
  now: () => Date;
}

const HOUR_MS = 3_600_000;
const SLOT_MS = HOUR_MS;

async function assertBookable(db: Database, start: Date, now: Date): Promise<void> {
  const [{ timezone }, { windows }] = await Promise.all([
    getSettings({ db }),
    getBusinessHours({ db }),
  ]);

  if (!isSlotBookable(start, { timezone, windows, now })) throw new SlotNotBookableError();
}

export async function bookAppointment(
  userId: string,
  input: BookAppointmentRequest,
  { db, now }: AppointmentsDependencies,
): Promise<Appointment> {
  const start = new Date(input.start);
  const end = new Date(start.getTime() + SLOT_MS);

  await assertBookable(db, start, now());
  const practitionerId = await findPractitionerId(db);

  // Freeness is deliberately not checked above: the EXCLUDE constraint decides
  // the winner of a race, and the transaction leaves no block behind a failure.
  try {
    return await db.transaction(async (tx) => {
      const [block] = await tx
        .insert(calendarBlocks)
        .values({
          practitionerId,
          kind: 'appointment',
          period: tstzrangeOf({ start, end }),
        })
        .returning({
          id: calendarBlocks.id,
          start: periodStart,
          end: periodEnd,
          status: calendarBlocks.status,
        });

      if (block === undefined) throw new Error('calendar block insert returned no row');

      const [appointment] = await tx
        .insert(appointments)
        .values({ blockId: block.id, userId })
        .returning({ id: appointments.id });

      if (appointment === undefined) throw new Error('appointment insert returned no row');

      return {
        id: appointment.id,
        start: block.start.toISOString(),
        end: block.end.toISOString(),
        status: block.status,
      };
    });
  } catch (error) {
    if (isPostgresError(error, PG_EXCLUSION_VIOLATION, 'calendar_blocks_no_overlap')) {
      throw new SlotTakenError();
    }

    throw error;
  }
}

async function explainMissedCancel(
  db: Database,
  userId: string,
  appointmentId: string,
  cutoffHours: number,
): Promise<never> {
  const [appointment] = await db
    .select({ userId: appointments.userId, status: calendarBlocks.status })
    .from(appointments)
    .innerJoin(calendarBlocks, eq(calendarBlocks.id, appointments.blockId))
    .where(eq(appointments.id, appointmentId));

  if (appointment === undefined) throw new NotFoundError('No such appointment');
  if (appointment.userId !== userId) throw new ForbiddenError();
  if (appointment.status !== 'active') {
    throw new AlreadyCancelledError('That appointment is already cancelled');
  }

  throw new CancellationCutoffPassedError(cutoffHours);
}

export async function cancelAppointment(
  userId: string,
  appointmentId: string,
  { db, now }: AppointmentsDependencies,
): Promise<Appointment> {
  const { cancellation_cutoff_hours: cutoffHours } = await getSettings({ db });
  const earliestCancellableStart = new Date(now().getTime() + cutoffHours * HOUR_MS);

  const ownBlock = db
    .select({ id: appointments.blockId })
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)));

  // One conditional UPDATE, so two concurrent cancels cannot both succeed; the
  // read in explainMissedCancel only classifies a miss.
  const [block] = await db
    .update(calendarBlocks)
    .set({ status: 'cancelled' })
    .where(
      and(
        inArray(calendarBlocks.id, ownBlock),
        eq(calendarBlocks.status, 'active'),
        sql`${periodStart} >= ${earliestCancellableStart.toISOString()}::timestamptz`,
      ),
    )
    .returning({ start: periodStart, end: periodEnd, status: calendarBlocks.status });

  if (block === undefined) return explainMissedCancel(db, userId, appointmentId, cutoffHours);

  return {
    id: appointmentId,
    start: block.start.toISOString(),
    end: block.end.toISOString(),
    status: block.status,
  };
}
