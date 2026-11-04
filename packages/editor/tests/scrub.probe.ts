// Usage: node packages/editor/tests/scrub.probe.ts [output interval, s]. Scrubs a recorded run in the real editor, on the real GPU,
// against the running local stack. The display's own refresh limits the frames there are; what matters is that the time shown
// keeps up with them.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

type Seen = { frames: number; moved: number; last: string; longest: number; since: number };
process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
const address = `http://127.0.0.1:${process.env.GRIDKIT_EDITOR_PORT}/`, seconds = 6, interval = Number(process.argv[2] ?? 0.0005);
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const browser = await chromium.launch({ headless: false, channel: 'chromium', args: ['--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const failures: string[] = [];
page.on('pageerror', error => failures.push(error.message));
await page.goto(address);
await page.locator('input[type=file]').first().setInputFiles(fileURLToPath(new URL('../../../library/WECC240.case.json', import.meta.url)));
await page.getByRole('button', { name: 'Preferences', exact: true }).click();
await page.getByRole('dialog', { name: 'Preferences', exact: true }).getByRole('button', { name: 'Solver', exact: true }).click();
await page.getByLabel('Import solver file', { exact: true }).setInputFiles({ name: 'dense.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(
  { tmax: 10, dt_monitor: interval, events: [{ type: 'fault_on', time: 1, bus: 4005, R: 0.001, X: 0.02 }, { type: 'fault_off', time: 1.15, bus: 4005 }] })) });
const run = page.getByRole('button', { name: 'Run simulation', exact: true });
await run.waitFor();
while (!(await run.isEnabled())) await sleep(100);
await run.click();
const results = page.getByRole('region', { name: 'Simulation', exact: true });
await results.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 60_000 });
await sleep(1500);

let reads = 0;
page.on('request', request => { if (/\/api\/runs\/[^/]+\/(rows|summary)$/.test(new URL(request.url()).pathname)) reads++; });
await page.evaluate(() => {
  const probe = window as unknown as Window & { seen: Seen; seenFrame: number };
  const clock = document.querySelector<HTMLInputElement>('input[aria-label="Simulation time"]')!;
  const seen = probe.seen = { frames: 0, moved: 0, last: clock.value, longest: 0, since: performance.now() };
  const frame = (now: number) => {
    seen.frames++;
    if (clock.value !== seen.last) { seen.moved++; seen.last = clock.value; seen.since = now; }
    else seen.longest = Math.max(seen.longest, now - seen.since);
    probe.seenFrame = requestAnimationFrame(frame);
  };
  probe.seenFrame = requestAnimationFrame(frame);
});
const slider = (await results.getByRole('slider').first().boundingBox())!;
const y = slider.y + slider.height / 2, at = (fraction: number) => slider.x + slider.width * (0.05 + 0.9 * fraction);
await page.mouse.move(at(0), y);
await page.mouse.down();
const started = Date.now();
while (Date.now() - started < seconds * 1000) {
  const phase = ((Date.now() - started) / 3000) % 2;
  await page.mouse.move(at(phase < 1 ? phase : 2 - phase), y);
  await sleep(8);
}
await page.mouse.up();
const seen = await page.evaluate(() => {
  const probe = window as unknown as Window & { seen: Seen; seenFrame: number };
  cancelAnimationFrame(probe.seenFrame);
  return probe.seen;
});
await browser.close();

const shown = seen.moved / seconds, frames = seen.frames / seconds;
console.log(`${frames.toFixed(1)} frames/s, time moved in ${shown.toFixed(1)}/s, longest hold ${Math.round(seen.longest)} ms, ${reads} reads`);
const problems = [...failures];
if (reads) problems.push(`Scrubbing asked the solver ${reads} times.`);
if (shown < frames * 0.8) problems.push('The time shown fell behind the frames.');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
