import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createBoss, createJobQueue, type JobQueue, startBoss } from '../jobs/boss.js';

declare module 'fastify' {
  interface FastifyInstance {
    jobs: JobQueue;
  }
}

export interface JobsPluginOptions {
  connectionString: string;
}

async function jobsPlugin(
  app: FastifyInstance,
  { connectionString }: JobsPluginOptions,
): Promise<void> {
  const boss = await startBoss(
    createBoss({
      connectionString,
      role: 'api',
      onError: (error) => {
        app.log.error(error, 'pg-boss error');
      },
    }),
  );

  app.decorate('jobs', createJobQueue(boss));

  app.addHook('onClose', async () => {
    await boss.stop();
  });
}

export default fp(jobsPlugin, { name: 'jobs' });
