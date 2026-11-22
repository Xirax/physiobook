import { appointments, calendarBlocks, users } from '@physiobook/db';
import { and, eq } from 'drizzle-orm';
import type { WorkHandler } from 'pg-boss';
import { z } from 'zod';

import { periodEnd, periodStart } from '../lib/period.js';
import { getSettings } from '../modules/settings/settings.service.js';

import { cancellationMail } from './cancellation-mail.js';
import { claimAndSend, type NotificationDependencies } from './notification.js';

export const sendCancellationPayloadSchema = z.strictObject({
  appointmentId: z.uuid(),
});

export type SendCancellationPayload = z.infer<typeof sendCancellationPayloadSchema>;

export async function sendCancellation(
  appointmentId: string,
  dependencies: NotificationDependencies,
): Promise<void> {
  const { db } = dependencies;
  const [appointment] = await db
    .select({
      userId: users.id,
      email: users.email,
      patientName: users.fullName,
      start: periodStart,
      end: periodEnd,
    })
    .from(appointments)
    .innerJoin(calendarBlocks, eq(calendarBlocks.id, appointments.blockId))
    .innerJoin(users, eq(users.id, appointments.userId))
    .where(
      and(eq(appointments.id, appointmentId), eq(calendarBlocks.status, 'cancelled_by_admin')),
    );

  if (appointment === undefined) return;

  const { timezone } = await getSettings({ db });

  await claimAndSend(
    {
      dedupeKey: `cancellation:${appointmentId}`,
      type: 'cancellation_user',
      recipientRole: 'user',
      recipientUserId: appointment.userId,
      to: appointment.email,
      content: cancellationMail({ timezone, appointment }),
    },
    dependencies,
  );
}

export function createSendCancellationHandler(
  dependencies: NotificationDependencies,
): WorkHandler<unknown> {
  return async (jobs) => {
    for (const job of jobs) {
      const { appointmentId } = sendCancellationPayloadSchema.parse(job.data);
      await sendCancellation(appointmentId, dependencies);
    }
  };
}
