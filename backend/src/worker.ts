import { loadWorkerEnv } from './config/env.js';
import { startWorker } from './jobs/worker.js';

const env = loadWorkerEnv();

const worker = await startWorker({
  connectionString: env.DATABASE_URL,
  health: { port: env.WORKER_HEALTH_PORT, host: env.WORKER_HEALTH_HOST },
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    worker.health.log.info({ signal }, 'draining in-flight jobs before exit');
    void worker
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        worker.health.log.error(error, 'error during shutdown');
        process.exit(1);
      });
  });
}
