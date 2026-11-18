import {
  appointments,
  calendarBlocks,
  notificationLog,
  users,
  type Database,
} from '@physiobook/db';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { WorkHandler } from 'pg-boss';
import { z } from 'zod';

import type { MailContent } from '../lib/mail-template.js';
import type { Mailer } from '../lib/mailer.js';
import { periodEnd, periodStart } from '../lib/period.js';
import { getSettings } from '../modules/settings/settings.service.js';

import {
  adminRunReminderMail,
  type ReminderAppointment,
  userReminderMail,
} from './reminder-mail.js';

export const sendReminderPayloadSchema = z.strictObject({
  appointmentId: z.uuid(),
});

export type SendReminderPayload = z.infer<typeof sendReminderPayloadSchema>;

export interface ReminderDependencies {
  db: Database;
  mailer: Mailer;
  now: () => Date;
}

interface Notification {
  dedupeKey: string;
  type: 'reminder_user' | 'reminder_admin_grouped';
  recipientRole: 'user' | 'admin';
  recipientUserId: string;
  to: string;
  content: MailContent;
}

/**
 * The claim and the send share a transaction: a failed send rolls the claim
 * back so pg-boss can retry, and a concurrent duplicate blocks on the unique
 * dedupe_key until this commits, then finds the key taken.
 */
async function claimAndSend(
  { to, content, ...entry }: Notification,
  { db, mailer, now }: ReminderDependencies,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(notificationLog)
      .values({ ...entry, sentAt: now(), payload: { to, subject: content.subject } })
      .onConflictDoNothing({ target: notificationLog.dedupeKey })
      .returning({ id: notificationLog.id });

    if (claimed === undefined) return;

    await mailer.send({ to, ...content });
  });
}

const activeAppointmentColumns = {
  userId: users.id,
  email: users.email,
  patientName: users.fullName,
  practitionerId: calendarBlocks.practitionerId,
  start: periodStart,
  end: periodEnd,
};

type ActiveAppointment = ReminderAppointment & {
  userId: string;
  email: string;
  practitionerId: string;
};

type Run = [ActiveAppointment, ...ActiveAppointment[]];

const withId = (appointmentId: string) => eq(appointments.id, appointmentId);

const startingAt = (practitionerId: string, instant: Date) =>
  and(
    eq(calendarBlocks.practitionerId, practitionerId),
    sql`${periodStart} = ${instant.toISOString()}::timestamptz`,
  );

const endingAt = (practitionerId: string, instant: Date) =>
  and(
    eq(calendarBlocks.practitionerId, practitionerId),
    sql`${periodEnd} = ${instant.toISOString()}::timestamptz`,
  );

async function findActiveAppointment(
  db: Database,
  condition: SQL | undefined,
): Promise<ActiveAppointment | undefined> {
  const [appointment] = await db
    .select(activeAppointmentColumns)
    .from(appointments)
    .innerJoin(calendarBlocks, eq(calendarBlocks.id, appointments.blockId))
    .innerJoin(users, eq(users.id, appointments.userId))
    .where(and(eq(calendarBlocks.status, 'active'), condition))
    .limit(1);

  return appointment;
}

const findPrevious = (db: Database, { practitionerId, start }: ActiveAppointment) =>
  findActiveAppointment(db, endingAt(practitionerId, start));

const findNext = (db: Database, { practitionerId, end }: ActiveAppointment) =>
  findActiveAppointment(db, startingAt(practitionerId, end));

/**
 * The active appointments back to back from `first`, earliest first — or
 * undefined when another active appointment ends where `first` starts, as the
 * run then starts there instead.
 */
async function findRunStartingWith(
  db: Database,
  first: ActiveAppointment,
): Promise<Run | undefined> {
  if ((await findPrevious(db, first)) !== undefined) return undefined;

  const run: Run = [first];
  let next = await findNext(db, first);

  while (next !== undefined) {
    run.push(next);
    next = await findNext(db, next);
  }

  return run;
}

async function findEmail(db: Database, userId: string): Promise<string> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));

  if (user === undefined) throw new Error(`user ${userId} is missing`);

  return user.email;
}

export async function sendReminders(
  appointmentId: string,
  dependencies: ReminderDependencies,
): Promise<void> {
  const { db } = dependencies;
  const appointment = await findActiveAppointment(db, withId(appointmentId));

  if (appointment === undefined) return;

  const { timezone } = await getSettings({ db });

  await claimAndSend(
    {
      dedupeKey: `reminder:user:${appointmentId}`,
      type: 'reminder_user',
      recipientRole: 'user',
      recipientUserId: appointment.userId,
      to: appointment.email,
      content: userReminderMail({ timezone, appointment }),
    },
    dependencies,
  );

  const run = await findRunStartingWith(db, appointment);

  if (run === undefined) return;

  await claimAndSend(
    {
      dedupeKey: `reminder:admin-run:${appointment.practitionerId}:${appointment.start.toISOString()}`,
      type: 'reminder_admin_grouped',
      recipientRole: 'admin',
      recipientUserId: appointment.practitionerId,
      to: await findEmail(db, appointment.practitionerId),
      content: adminRunReminderMail({ timezone, appointments: run }),
    },
    dependencies,
  );
}

export function createSendReminderHandler(
  dependencies: ReminderDependencies,
): WorkHandler<unknown> {
  return async (jobs) => {
    for (const job of jobs) {
      const { appointmentId } = sendReminderPayloadSchema.parse(job.data);
      await sendReminders(appointmentId, dependencies);
    }
  };
}
