import { createDatabase } from '@physiobook/db';
import Fastify, { type FastifyInstance, LogController } from 'fastify';
import type { PgBoss, WorkHandler } from 'pg-boss';

import type { Mailer } from '../lib/mailer.js';

import { createBoss, type QueueName, startBoss } from './boss.js';
import { noopHandler } from './noop.job.js';
import type { NotificationDependencies } from './notification.js';
import { createSendCancellationHandler } from './send-cancellation.job.js';
import { createSendReminderHandler } from './send-reminder.job.js';

export type JobHandlers = Record<QueueName, WorkHandler<unknown>>;

export function createDefaultHandlers(dependencies: NotificationDependencies): JobHandlers {
  return {
    noop: noopHandler,
    'send-cancellation': createSendCancellationHandler(dependencies),
    'send-reminder': createSendReminderHandler(dependencies),
  };
}

/**
 * How long a SIGTERM waits for in-flight jobs before pg-boss gives up on them.
 * Must stay below the worker's `stop_grace_period` in docker-compose.yml, or
 * Docker SIGKILLs the process mid-drain.
 */
export const SHUTDOWN_TIMEOUT_MS = 20_000;

export interface WorkerOptions {
  connectionString: string;
  health: { port: number; host: string };
  mailer: Mailer;
  /** Replaces individual default handlers, e.g. to count invocations in a test. */
  handlers?: Partial<JobHandlers>;
  now?: () => Date;
  logger?: boolean;
}

export interface Worker {
  boss: PgBoss;
  health: FastifyInstance;
  close: () => Promise<void>;
}

function createHealthServer(logger: boolean): FastifyInstance {
  // The healthcheck polls every few seconds; logging each probe would bury
  // the job logs this process exists to produce.
  return Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
  });
}

function registerHealthCheck(app: FastifyInstance, boss: PgBoss): void {
  app.get('/health', async (_request, reply) => {
    try {
      await boss.getDb().executeSql('SELECT 1');

      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}

export function buildHealthServer(boss: PgBoss, logger = true): FastifyInstance {
  const app = createHealthServer(logger);
  registerHealthCheck(app, boss);

  return app;
}

export async function startWorker({
  connectionString,
  health: { port, host },
  mailer,
  handlers: overrides = {},
  now = () => new Date(),
  logger = true,
}: WorkerOptions): Promise<Worker> {
  const health = createHealthServer(logger);
  const boss = createBoss({
    connectionString,
    role: 'worker',
    onError: (error) => {
      health.log.error(error, 'pg-boss error');
    },
  });
  registerHealthCheck(health, boss);

  await startBoss(boss);

  const database = createDatabase(connectionString, { application_name: 'physiobook-worker' });
  const handlers = { ...createDefaultHandlers({ db: database.db, mailer, now }), ...overrides };
  // close() may be retried after pg-boss fails to stop; the pool may end only once.
  let databaseClosing: Promise<void> | undefined;
  const closeDatabase = () => (databaseClosing ??= database.close());

  try {
    for (const [name, handler] of Object.entries(handlers)) {
      await boss.work(name, handler);
    }

    await health.listen({ port, host });
  } catch (error) {
    await boss.stop({ graceful: false });
    await closeDatabase();
    throw error;
  }

  return {
    boss,
    health,
    close: async () => {
      try {
        await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
      } finally {
        await Promise.all([closeDatabase(), health.close()]);
      }
    },
  };
}

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Runs a worker until SIGTERM/SIGINT, then drains it; resolves the exit code.
 * The signal listeners go on before `start()`, so a stop requested mid-boot
 * still drains instead of killing the process with Node's default 143.
 */
export async function runWorker(
  start: () => Promise<Worker>,
  signals: NodeJS.EventEmitter = process,
): Promise<number> {
  const signalled = new Promise<NodeJS.Signals>((resolve) => {
    for (const signal of SHUTDOWN_SIGNALS) {
      signals.once(signal, () => {
        resolve(signal);
      });
    }
  });

  const worker = await start();
  const signal = await signalled;

  worker.health.log.info({ signal }, 'draining in-flight jobs before exit');

  try {
    await worker.close();

    return 0;
  } catch (error) {
    worker.health.log.error(error, 'error during shutdown');

    return 1;
  }
}
