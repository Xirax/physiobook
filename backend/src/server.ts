import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildServerOptions {
  /**
   * Request logging. On by default so the running server is observable; tests
   * turn it off, since a pino line per `.inject()` call buries the actual test
   * output.
   */
  logger?: boolean;
}

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
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  // Liveness probe. The compose healthcheck is TCP-level (it only proves the
  // port accepts connections), so this endpoint is the human/CI-friendly
  // counterpart — it proves the process is actually serving requests.
  app.get('/health', () => ({ status: 'ok' }));

  return app;
}
