import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Every program here reads .env; `pnpm smoke` finds the running stack by it.
const settings = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(settings)) process.loadEnvFile(settings);

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Relative, so one build serves from any path; the editor finds config.json, and its services, beside it.
  base: './',
  plugins: [svelte()],
  // The solver in the page starts GridKit's worker from its own, which imports the module at run time.
  worker: { format: 'es' as const },
  // `pnpm smoke` drives the running stack; everything else runs without one.
  test: { include: mode === 'smoke' ? ['tests/*.smoke.ts'] : ['src/**/*.test.ts'], environment: 'node' },
}));
