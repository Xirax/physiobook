// Piped into the running worker container by .github/workflows/docker-smoke.yml:
// enqueues a no-op through the API's compiled queue module and waits for the
// worker service to complete it. Paths are the runtime image's, not the repo's.
const { createBoss, createJobQueue, startBoss, QUEUES } =
  await import('/app/backend/dist/jobs/boss.js');

const POLL_INTERVAL_MS = 500;
const ATTEMPTS = 60;

const boss = await startBoss(
  createBoss({
    connectionString: process.env.DATABASE_URL,
    role: 'api',
    onError: (error) => {
      console.error(error);
      process.exit(1);
    },
  }),
);

const id = await createJobQueue(boss).send(QUEUES.noop, { probe: 'docker-smoke' });

for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
  const [job] = await boss.findJobs(QUEUES.noop, { id });

  if (job?.state === 'completed') {
    console.log(`noop job ${id} completed by the worker`);
    await boss.stop();
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

console.error(`noop job ${id} was not completed within ${(ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
process.exit(1);
