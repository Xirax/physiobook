import { loadWorkerEnv } from './config/env.js';
import { runWorker, startWorker } from './jobs/worker.js';
import { createMailer, mailerConfigFromEnv } from './lib/mailer.js';

const env = loadWorkerEnv();
const mailer = createMailer(mailerConfigFromEnv(env));

const exitCode = await runWorker(() =>
  startWorker({
    connectionString: env.DATABASE_URL,
    health: { port: env.WORKER_HEALTH_PORT, host: env.WORKER_HEALTH_HOST },
    mailer,
  }),
).finally(() => {
  mailer.close();
});

process.exit(exitCode);
