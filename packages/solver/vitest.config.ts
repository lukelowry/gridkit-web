import { defineConfig } from 'vitest/config';

// `pnpm smoke` holds the running containers' solver to the contract; everything else runs without them.
export default defineConfig(({ mode }) => ({
  test: { include: mode === 'smoke' ? ['test/*.smoke.ts'] : ['src/**/*.test.ts'], environment: 'node' },
}));
