import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests read the same settings as every other program, such as which GridKit runtime image simulates natively.
const settings = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(settings)) process.loadEnvFile(settings);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // One browser at a time.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/', trace: 'retain-on-failure' },
  projects: [
    // Views draw on this machine's GPU, as for users; the suite runs on developers' machines, never in CI. A scaled display
    // otherwise gives headed canvases device pixels that disagree with devicePixelRatio.
    { name: 'chromium', use: { channel: 'chromium', launchOptions: { args: ['--force-device-scale-factor=1'] } } },
    // The shell, library and table must work without WebGPU and without opening the touch keyboard: `--project webkit`.
    { name: 'webkit', testMatch: ['**/library.spec.ts', '**/shell.spec.ts', '**/welcome.spec.ts', '**/dock.spec.ts', '**/focus.spec.ts', '**/simulation.spec.ts'],
      use: { ...devices['iPad (gen 7)'], browserName: 'webkit' } },
  ],
  // The built editor, served as a static site serves it: nothing beside it.
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: false,
  },
});
