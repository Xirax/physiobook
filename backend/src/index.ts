import { loadEnv } from './config/env.js';
import { buildServer } from './server.js';

const env = loadEnv();

const app = await buildServer({
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  jwtTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
  refreshTtlSeconds: env.REFRESH_TTL_SECONDS,
  // The refresh cookie is `Secure` wherever there is TLS to be secure over.
  // Setting it in development would have the browser drop it on http://localhost
  // and break the refresh flow with no error anyone would see.
  secureCookies: env.NODE_ENV === 'production',
  rateLimit: {
    max: env.AUTH_RATE_LIMIT_MAX,
    refreshMax: env.REFRESH_RATE_LIMIT_MAX,
    timeWindow: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
  },
  trustProxy: env.TRUST_PROXY,
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
