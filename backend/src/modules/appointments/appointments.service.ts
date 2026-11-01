import { appointments, calendarBlocks, type Database } from '@physiobook/db';
import type { Appointment, BookAppointmentRequest } from '@physiobook/shared';
import { sql } from 'drizzle-orm';

import {
  isPostgresError,
  PG_EXCLUSION_VIOLATION,
  SlotNotBookableError,
  SlotTakenError,
} from '../../lib/errors.js';
import { getBusinessHours } from '../availability/business-hours.service.js';
import { isSlotBookable } from '../availability/slot-grid.js';
import { findPractitionerId } from '../practitioner/practitioner.service.js';
import { getSettings } from '../settings/settings.service.js';

export interface AppointmentsDependencies {
  db: Database;
  now: () => Date;
}

const SLOT_MS = 3_600_000;

// Drizzle's pg driver hands timestamptz back as a string; borrowing a
// timestamptz column's mapper turns it into a Date.
const startOf = sql`lower(${calendarBlocks.period})`.mapWith(calendarBlocks.createdAt);
const endOf = sql`upper(${calendarBlocks.period})`.mapWith(calendarBlocks.createdAt);

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
          period: sql`tstzrange(${start.toISOString()}, ${end.toISOString()}, '[)')`,
        })
        .returning({
          id: calendarBlocks.id,
          start: startOf,
          end: endOf,
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
