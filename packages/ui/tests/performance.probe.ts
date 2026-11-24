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
  const directory = new URL('../../../output/playwright/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const workloads = [
    [100_000, 256, 'plain'], [1_000_000, 256, 'plain'],
    [1_000_000, 32, 'plain', 'vertices'], [1_000_000, 32, 'plain', 'edges'], [1_000_000, 32, 'plain', 'sampled'],
    [1_000_000, 256, 'markers'], [1_000_000, 256, 'halos'], [1_000_000, 256, 'labels'],
  ] as const;
  const budgetOnly = process.argv.includes('--budget-only');
  const report = budgetOnly ? 'latkit-budget.json' : 'latkit-performance.json';
  for (const [size, budget, detail, stage = 'playback' as const] of workloads) {
    if (budgetOnly && budget !== 32) continue;
    await page.goto(address);
    try {
      const measured = await page.evaluate(async ({ size, budget, detail, stage }) => {
        const url = '/tests/performance.ts';
        const { measureNetwork } = await import(url) as typeof import('./performance.js');
        return measureNetwork(size, budget, detail, stage);
      }, { size, budget, detail, stage });
      scenarios.push(measured);
    } catch (error) {
      scenarios.push({ size, budgetMiB: budget, detail, stage, error: error instanceof Error ? error.message : String(error) });
    }
    console.log(JSON.stringify(scenarios.at(-1)));
    await writeFile(new URL(report, directory), JSON.stringify({ environment, realCaseOpenMs, scenarios, failures }, null, 2));
  }
  if (failures.length || scenarios.some(s => 'error' in s)) throw new Error(`One or more browser scenarios failed. See ${report}.`);
  console.log(`ACTIVSg10k open: ${realCaseOpenMs} ms; report: output/playwright/${report}`);
} finally { await browser.close(); }
