import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Relative, so one build serves from any path; the UI finds config.json, and its services, beside it.
  base: './',
  plugins: [svelte()],
  // Keep small worker scripts as files: data URLs are blocked by the browser's connection policy.
  build: { assetsInlineLimit: 0 },
  // Latkit locates its WASM and worker beside its modules. Dependency prebundling moves those URLs in development.
  optimizeDeps: { exclude: ['latkit'] },
  // The solver in the page starts GridKit's worker from its own, which imports the module at run time.
  worker: { format: 'es' as const },
  // `pnpm smoke` drives the running containers; everything else runs without them.
  test: { include: mode === 'smoke' ? ['tests/*.smoke.ts'] : ['src/**/*.test.ts'], environment: 'node' },
}));
