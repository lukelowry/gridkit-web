import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `pnpm smoke` holds the running stack's editor container to what it serves; there is nothing to test without the stack.
const settings = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(settings)) process.loadEnvFile(settings);

export default defineConfig(({ mode }) => ({
  test: { include: mode === 'smoke' ? ['*.smoke.ts'] : [], passWithNoTests: true, environment: 'node' },
}));
