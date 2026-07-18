import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Builds and configures the Fastify instance.
 *
 * Kept separate from index.ts (which listens) so tests can build an app and
 * drive it with `.inject()` without ever binding a port — see
 * PROJECT_STRUCTURE.md §4.
 *
 * At ticket 0.2 this is deliberately bare: it exists so the docker stack has a
 * real HTTP server to boot and healthcheck. Plugins (db, auth, cookie, error
 * handler) and route modules are registered here as their tickets land.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  // Liveness probe. The compose healthcheck is TCP-level (it only proves the
  // port accepts connections), so this endpoint is the human/CI-friendly
  // counterpart — it proves the process is actually serving requests.
  app.get('/health', () => ({ status: 'ok' }));

  return app;
}
