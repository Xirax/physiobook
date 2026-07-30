import { loadEnv } from './config/env.js';
import { buildServer } from './server.js';

const env = loadEnv();

const app = await buildServer({
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  jwtTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
});

try {
  await app.listen({ port: env.BACKEND_PORT, host: env.BACKEND_HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error(error, 'error during shutdown');
        process.exit(1);
      });
  });
}
