// Start `pnpm -F @gridkit/ui exec vite --host 127.0.0.1 --port 4174`, then:
// node packages/ui/tests/performance.probe.ts [server URL]
// Measurements are machine-specific. The real case covers import and app opening; synthetic cases isolate rendering.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const address = process.argv[2] ?? 'http://127.0.0.1:4174/';
const browser = await chromium.launch({ channel: 'chromium', args: ['--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures: string[] = [];
page.on('pageerror', error => failures.push(error.message));
await page.route('**/config.json', route => route.fulfill({ json: {} }));
await page.addInitScript(() => localStorage.setItem('gridkit.preferences', JSON.stringify({ geography: 'none', motion: 'reduce' })));
try {
  await page.goto(address);
  const started = Date.now();
  await page.getByLabel('Open case file', { exact: true }).setInputFiles(fileURLToPath(new URL('../../../library/ACTIVSg10k.case.json', import.meta.url)));
  await expect(page.getByLabel('Network view', { exact: true })).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  const realCaseOpenMs = Date.now() - started;
  console.log(`ACTIVSg10k open: ${realCaseOpenMs} ms`);
  const environment = await page.evaluate(() => {
    const gl = new OffscreenCanvas(2, 2).getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension ? String(gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return { userAgent: navigator.userAgent, pixelRatio: devicePixelRatio, renderer };
  });
  console.log(environment.renderer);
  const scenarios = [];
  for (const [size, budget] of [[100_000, 256], [1_000_000, 256], [1_000_000, 32]] as const) {
    await page.goto(address); // Each scenario owns a fresh GPU and an empty app.
    const measured = await page.evaluate(async ({ size, budget }) => {
      const url = '/tests/performance.ts';
      const { measureNetwork } = await import(url) as typeof import('./performance.js');
      return measureNetwork(size, budget);
    }, { size, budget });
    scenarios.push(measured);
    console.log(JSON.stringify(measured));
  }
  if (failures.length) throw new Error(failures.join('\n'));
  const directory = new URL('../../../output/playwright/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('latkit-performance.json', directory), JSON.stringify({ environment, realCaseOpenMs, scenarios }, null, 2));
  console.log(`ACTIVSg10k open: ${realCaseOpenMs} ms; report: output/playwright/latkit-performance.json`);
} finally { await browser.close(); }
