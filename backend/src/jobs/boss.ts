import { PgBoss, type SendOptions } from 'pg-boss';

export const QUEUES = {
  noop: 'noop',
  sendCancellation: 'send-cancellation',
  sendReminder: 'send-reminder',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type BossRole = 'api' | 'worker';

export interface CreateBossOptions {
  connectionString: string;
  role: BossRole;
  onError: (error: Error) => void;
}

/**
 * The API and the worker build their instance here so both agree on the
 * schema, the queues and who runs maintenance. Supervision and cron belong to
 * the worker alone: two processes doing the same housekeeping only contend.
 */
export function createBoss({ connectionString, role, onError }: CreateBossOptions): PgBoss {
  const boss = new PgBoss({
    connectionString,
    application_name: `physiobook-${role}`,
    supervise: role === 'worker',
    schedule: role === 'worker',
  });

  // An EventEmitter 'error' with no listener throws, and pg-boss emits them
  // from background loops — unhandled, one lost connection kills the process.
  boss.on('error', onError);

  return boss;
}

export async function startBoss(boss: PgBoss): Promise<PgBoss> {
  await boss.start();

  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name);
  }

  return boss;
}

/** What the API may do with jobs: enqueue them, never consume them. */
export interface JobQueue {
  send: (name: QueueName, data?: object | null, options?: SendOptions) => Promise<string | null>;
}

export function createJobQueue(boss: PgBoss): JobQueue {
  return {
    send: (name, data = null, options = {}) => boss.send(name, data, options),
  };
}
