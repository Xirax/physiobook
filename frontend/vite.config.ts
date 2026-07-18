import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config. Vitest's `test` block is added when the test tooling lands
 * (PROJECT_STRUCTURE.md §3).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind all interfaces: bound to localhost the dev server is invisible from
    // outside the container.
    host: true,
    port: 5173,

    // Filesystem events do not cross the Windows/WSL2 bind-mount boundary, so
    // without polling an edit on the host never reaches the watcher inside the
    // container and HMR silently stops firing. Enabled only by
    // docker-compose.override.yml — polling burns CPU and is pointless when
    // running natively on the host.
    watch: process.env['VITE_USE_POLLING'] === 'true' ? { usePolling: true, interval: 300 } : null,

    // HMR client connects back on the published host port.
    hmr: { clientPort: Number(process.env['FRONTEND_PORT'] ?? 5173) },
  },
});
