import { defineConfig } from 'vitest/config';

// `pnpm smoke` holds the running stack's solver to the contract; everything else runs without one.
export default defineConfig(({ mode }) => ({
  test: { include: mode === 'smoke' ? ['test/*.smoke.ts'] : ['src/**/*.test.ts'], environment: 'node' },
}));
