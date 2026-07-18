import { buildServer } from './server.js';

/**
 * Boots the API server.
 *
 * Env is read directly here at ticket 0.2 because no secret is involved yet.
 * Ticket E1 introduces `src/config/env.ts` (Zod-validated, fail-fast) and this
 * file switches to it — see CLAUDE.md §5.8.
 */
const port = Number(process.env['BACKEND_PORT'] ?? 3000);

// Must be 0.0.0.0, not the Fastify default of localhost: a server bound to the
// container's loopback is unreachable from the host and from other services.
const host = process.env['BACKEND_HOST'] ?? '0.0.0.0';

const app = buildServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Docker sends SIGTERM on `compose down` / `compose restart`. Without this the
// process ignores it and waits out the 10s kill timeout on every restart.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
