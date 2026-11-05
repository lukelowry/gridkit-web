import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// `pnpm smoke` holds the running stack, found by .env, to the solver contract; everything else runs without one.
const settings = new URL('../../.env', import.meta.url);
if (existsSync(settings)) process.loadEnvFile(settings);

export default defineConfig(({ mode }) => ({
  test: { include: mode === 'smoke' ? ['test/*.smoke.ts'] : ['src/**/*.test.ts'], environment: 'node' },
}));
