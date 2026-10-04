import Fastify, { type FastifyInstance, LogController } from 'fastify';
import type { PgBoss, WorkHandler } from 'pg-boss';

import { createBoss, type QueueName, startBoss } from './boss.js';
import { noopHandler } from './noop.job.js';

export type JobHandlers = Record<QueueName, WorkHandler<unknown>>;

export const defaultHandlers: JobHandlers = {
  noop: noopHandler,
};

/**
 * How long a SIGTERM waits for in-flight jobs before pg-boss gives up on them.
 * Must stay below the worker's `stop_grace_period` in docker-compose.yml, or
 * Docker SIGKILLs the process mid-drain.
 */
export const SHUTDOWN_TIMEOUT_MS = 20_000;

export interface WorkerOptions {
  connectionString: string;
  health: { port: number; host: string };
  handlers?: JobHandlers;
  logger?: boolean;
}

export interface Worker {
  boss: PgBoss;
  health: FastifyInstance;
  close: () => Promise<void>;
}

export function buildHealthServer(boss: PgBoss, logger = true): FastifyInstance {
  // The healthcheck polls every few seconds; logging each probe would bury
  // the job logs this process exists to produce.
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.get('/health', async (_request, reply) => {
    try {
      await boss.getDb().executeSql('SELECT 1');

      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  return app;
}

export async function startWorker({
  connectionString,
  health: { port, host },
  handlers = defaultHandlers,
  logger = true,
}: WorkerOptions): Promise<Worker> {
  const boss = createBoss({
    connectionString,
    role: 'worker',
    onError: (error) => {
      health.log.error(error, 'pg-boss error');
    },
  });
  const health = buildHealthServer(boss, logger);

  await startBoss(boss);

  try {
    for (const [name, handler] of Object.entries(handlers)) {
      await boss.work(name, handler);
    }

    await health.listen({ port, host });
  } catch (error) {
    await boss.stop({ graceful: false });
    throw error;
  }

  return {
    boss,
    health,
    close: async () => {
      await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
      await health.close();
    },
  };
}
