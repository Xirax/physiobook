import { loadWorkerEnv } from './config/env.js';
import { runWorker, startWorker } from './jobs/worker.js';

const env = loadWorkerEnv();

process.exit(
  await runWorker(() =>
    startWorker({
      connectionString: env.DATABASE_URL,
      health: { port: env.WORKER_HEALTH_PORT, host: env.WORKER_HEALTH_HOST },
    }),
  ),
);
