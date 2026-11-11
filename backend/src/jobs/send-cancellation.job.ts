import type { WorkHandler } from 'pg-boss';
import { z } from 'zod';

export const sendCancellationPayloadSchema = z.strictObject({
  appointmentId: z.uuid(),
});

export type SendCancellationPayload = z.infer<typeof sendCancellationPayloadSchema>;

/** Placeholder until 4.4 sends the email; a malformed payload still fails the job. */
export const sendCancellationHandler: WorkHandler<unknown> = async (jobs) => {
  for (const job of jobs) sendCancellationPayloadSchema.parse(job.data);
};
