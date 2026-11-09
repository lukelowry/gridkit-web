import { defineConfig, devices } from '@playwright/test';

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
    // An iPad: views draw with WebGL2 as in Safari, and no touch keyboard may open.
    { name: 'webkit', use: { ...devices['iPad (gen 7)'], browserName: 'webkit' } },
  ],
  // The built UI, served as a static site serves it: nothing beside it.
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: false,
  },
});
