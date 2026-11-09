import { expect, test, type Locator, type Page } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };
import { completedRun } from './fixtures/completed-run.js';

async function openResults(page: Page, edge = false) {
  await page.addInitScript(() => localStorage.setItem('gridkit.preferences', JSON.stringify({ theme: 'light', geography: 'none', resultsDock: 'right' })));
  await completedRun(page);
  await page.goto('/');
  const value = structuredClone(fixture);
  if (edge) Object.assign(value.devices[0]!, { mon: ['p1'] });
  await page.getByLabel('Open case file', { exact: true }).setInputFiles({ name: 'monitor.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Simulation', exact: true });
  await expect(panel.locator('canvas')).toHaveAttribute('aria-busy', 'false');
  if (edge) await panel.getByRole('combobox', { name: 'Plot quantity' }).selectOption({ label: 'p1' });
  await page.getByRole('button', { name: 'Network', exact: true }).click();
  await expect(page.getByLabel('Network view', { exact: true })).toHaveAttribute('data-ready', 'true');
  return panel;
}

// Inspect the drawn pixels in the browser, returning one point instead of transferring them all. latkit copies each frame
// into the canvas's 2D context.
async function drawnPoint(canvas: Locator, kind: 'blue' | 'red' | 'south' | 'edge', limit?: number) {
  const bounds = (await canvas.boundingBox())!;
  const result = await canvas.evaluate((canvas: HTMLCanvasElement, { kind, limit }) => {
    const { width, height } = canvas, data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    const right = limit === undefined ? width : limit * width / canvas.clientWidth;
    let point: [number, number] | null = null, score = Infinity;
    const colored: [number, number][] = [];
    for (let y = 16; y < height - 30; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      const matches = kind === 'blue' ? b > r + 40 && g > r + 20 : r > g + 35 && r > b + 20;
      if (!matches || x < 10 || x > right - 20) continue;
      if (kind === 'south' || kind === 'edge') { colored.push([x, y]); continue; }
      if (x < 35 || y < 30) continue;
      const next = Math.abs(y - height * .4) + Math.abs(x - width * .3);
      if (next < score) { point = [x, y]; score = next; }
    }
    if (kind === 'south' || kind === 'edge') {
      // Two vertices joined by one straight branch; the southern vertex is Bus 2.
      const bottom = Math.max(...colored.map(p => p[1]));
      const points = colored.filter(p => kind === 'edge' || p[1] > bottom - 8);
      if (points.length) point = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
    }
    return { point, width, height };
  }, { kind, limit: limit === undefined ? undefined : limit - bounds.x });
  expect(result.point, 'the renderer draws the requested trace or element').not.toBeNull();
  return [bounds.x + result.point![0] * bounds.width / result.width, bounds.y + result.point![1] * bounds.height / result.height] as const;
}

for (const edge of [false, true]) test('monitor and network mirror hover and clicks for ' + (edge ? 'edges' : 'vertices'), async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = await openResults(page, edge), plot = panel.locator('canvas'), network = page.getByLabel('Network view', { exact: true });
  const readout = panel.getByLabel('Hovered series', { exact: true });
  const controls = [panel.getByLabel('Current simulation time'), panel.getByRole('button', { name: 'Play', exact: true }), panel.getByRole('combobox', { name: 'Playback speed' })];
  const before = await Promise.all(controls.map(control => control.boundingBox()));
  const point = await drawnPoint(plot, edge ? 'red' : 'blue'), identity = edge ? 'Branch line-1' : 'Bus 2';
  await page.mouse.move(...point);
  await expect(readout).toContainText(identity);
  await expect(network).toHaveAccessibleDescription(new RegExp('Hovered: ' + identity));
  expect(await Promise.all(controls.map(control => control.boundingBox()))).toEqual(before);
  await page.mouse.click(...point);
  await expect(network).toHaveAccessibleDescription(new RegExp('Selected: ' + identity));
  await expect(plot).toHaveAccessibleDescription(new RegExp('Selected: ' + identity));
  const location = await drawnPoint(network, edge ? 'edge' : 'south', (await panel.boundingBox())!.x);
  await page.mouse.move(10, 10);
  await expect(readout).toHaveText('');
  await page.mouse.move(...location);
  await expect(readout).toContainText(identity);
  await expect(plot).toHaveAccessibleDescription(new RegExp('Hovered: ' + identity));
  const rect = (await plot.boundingBox())!;
  await page.mouse.click(rect.x + rect.width * .85, rect.y + rect.height * .3);
  await expect(plot).not.toHaveAccessibleDescription(/Selected:/);
  await page.mouse.click(...location);
  await expect(plot).toHaveAccessibleDescription(new RegExp('Selected: ' + identity));
  await page.mouse.move(10, 10);
  await expect(readout).toHaveText('');
  await panel.getByRole('button', { name: 'Close results' }).click();
  await expect(network).not.toHaveAccessibleDescription(/Hovered:/);
});
