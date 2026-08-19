import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Read by the dev server, never by the bundle — hence no VITE_ prefix. The
// browser only ever learns this origin's own address, which is the point: no
// cross-origin request, no CORS layer, no `credentials: 'include'`.
const backendOrigin = process.env['BACKEND_ORIGIN'] ?? 'http://localhost:3000';

/**
 * Paths the dev server hands to the API instead of serving from the SPA.
 *
 * They are proxied *without rewriting*, which is the whole point: the refresh
 * cookie is scoped `path=/auth`, so the browser only sends it back to a URL that
 * still begins with `/auth`. A `/api` prefix would need the cookie's path
 * rewritten in two places to stay in agreement, and silent refresh would break
 * in the one way that looks like a logged-out user rather than an error.
 * `docker/frontend/nginx.conf` mirrors this list for the production build.
 */
const apiPaths = ['/auth', '/health'];

export default defineConfig({
  plugins: [react()],

  resolve: {
    // `@physiobook/shared` publishes its TypeScript source under the
    // `development` condition and `dist/` under `default` (PROJECT_STRUCTURE.md
    // §5). Naming it here makes dev, `vite build` and Vitest all read the same
    // source, so the client can never bundle a contract that was compiled from
    // a different commit than the one being typechecked — and coverage measures
    // shared/src rather than a build artifact.
    conditions: ['development', ...defaultClientConditions],
  },

  server: {
    // Bind all interfaces: bound to localhost the dev server is invisible from
    // outside the container.
    host: true,
    port: 5173,

    proxy: Object.fromEntries(
      apiPaths.map((path) => [path, { target: backendOrigin, changeOrigin: false, xfwd: true }]),
    ),

    // Filesystem events do not cross the Windows/WSL2 bind-mount boundary, so
    // without polling an edit on the host never reaches the watcher inside the
    // container and HMR silently stops firing. Enabled only by
    // docker-compose.override.yml — polling burns CPU and is pointless when
    // running natively on the host.
    watch: process.env['VITE_USE_POLLING'] === 'true' ? { usePolling: true, interval: 300 } : null,

    // HMR client connects back on the published host port.
    hmr: { clientPort: Number(process.env['FRONTEND_PORT'] ?? 5173) },
  },

  test: {
    name: 'frontend',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],

    // `fetch` is spied on in most of these suites; without this a stub set up
    // by one test is still the implementation the next one exercises.
    restoreMocks: true,
  },
});
