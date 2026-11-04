import { test, expect, type Page } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };
import { completedRun } from './fixtures/completed-run.js';

async function openResults(page: Page) {
  await completedRun(page);
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByLabel('Simulation status', { exact: true })).toHaveText('Completed');
}

test('results resize by pointer and keyboard, remember each edge, and stay within the workspace', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'This runner has no WebGPU adapter for result ingestion; resizing is covered in Chromium.');
  await page.setViewportSize({ width: 1280, height: 900 });
  await openResults(page);
  const panel = page.getByRole('region', { name: 'Simulation', exact: true });
  const horizontal = page.getByRole('separator', { name: 'Resize results height' });
  const height = () => panel.evaluate(element => element.getBoundingClientRect().height);
  const initial = await height();
  await horizontal.press('ArrowUp');
  await expect.poll(height).toBe(initial + 10);
  await horizontal.press('Shift+ArrowDown');
  await expect.poll(height).toBe(initial - 30);
  await horizontal.press('End');
  expect(await height()).toBe(Number(await horizontal.getAttribute('aria-valuemax')));
  await horizontal.press('Home');
  expect(await height()).toBe(Number(await horizontal.getAttribute('aria-valuemin')));
  await horizontal.press('Enter');
  await expect.poll(height).toBe(initial);
  const edge = (await horizontal.boundingBox())!;
  await page.mouse.move(edge.x + 40, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 40, edge.y - 64, { steps: 5 });
  await page.mouse.up();
  const dragged = await height();
  expect(dragged).toBeGreaterThan(initial + 60);
  const moved = (await horizontal.boundingBox())!;
  await page.mouse.move(moved.x + 40, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + 40, moved.y - 30);
  await horizontal.press('Escape');
  await page.mouse.move(moved.x + 40, moved.y - 60);
  await page.mouse.up();
  await expect.poll(height).toBe(dragged);
  await panel.getByRole('button', { name: 'Plot options', exact: true }).click();
  await panel.getByRole('button', { name: 'Collapse results', exact: true }).click();
  await expect(horizontal).toHaveCount(0);
  await panel.getByRole('button', { name: 'Plot options', exact: true }).click();
  await panel.getByRole('button', { name: 'Expand results', exact: true }).click();
  await expect.poll(height).toBe(dragged);
  await panel.getByRole('button', { name: 'Plot options', exact: true }).click();
  await panel.getByRole('button', { name: 'Dock results on the right' }).click();
  const vertical = page.getByRole('separator', { name: 'Resize results width' });
  await expect(vertical).toHaveAttribute('aria-orientation', 'vertical');
  const width = () => panel.evaluate(element => element.getBoundingClientRect().width);
  const before = await width();
  await vertical.press('ArrowLeft');
  await expect.poll(width).toBe(before + 10);
  await panel.getByRole('button', { name: 'Plot options', exact: true }).click();
  await panel.getByRole('button', { name: 'Dock results at the bottom' }).click();
  await expect.poll(height).toBe(dragged);
  await panel.getByRole('button', { name: 'Plot options', exact: true }).click();
  await panel.getByRole('button', { name: 'Dock results on the right' }).click();
  await expect.poll(width).toBe(before + 10);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(horizontal).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Dock results on the right' })).toHaveCount(0);
  expect(await panel.evaluate(element => {
    const pane = element.getBoundingClientRect(), workspace = element.closest('main')!.getBoundingClientRect();
    return pane.top >= workspace.top && pane.bottom <= workspace.bottom && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await page.emulateMedia({ forcedColors: 'active' });
  await horizontal.press('ArrowUp');
  expect(await horizontal.locator('span').evaluate(element => getComputedStyle(element, '::after').outlineStyle)).toBe('solid');
});

test('results keep one header row and expose display, reference and layout in shared options', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'This runner has no WebGPU adapter for result ingestion.');
  await page.setViewportSize({ width: 320, height: 740 });
  await openResults(page);
  const panel = page.getByRole('region', { name: 'Simulation', exact: true });
  const quantity = panel.getByRole('combobox', { name: 'Plot quantity', exact: true });
  await expect(quantity).toBeEnabled();
  await quantity.selectOption({ label: 'Voltage magnitude' });
  await panel.locator('canvas[aria-busy="false"]').waitFor();
  await panel.getByRole('button', { name: 'Plot options', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Plot options', exact: true });
  await expect(options.getByRole('radio', { name: 'Value', exact: true })).toBeFocused();
  await options.getByRole('radio', { name: 'Percent change', exact: true }).check();
  await expect(options.getByRole('radio', { name: 'Percent change', exact: true })).toBeChecked();
  await expect(panel.locator('.results-unit')).toHaveText('(% change)');
  await options.getByRole('button', { name: 'From current time', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Plot options', exact: true })).toBeFocused();
  await quantity.selectOption({ label: 'Voltage angle' });
  await panel.getByRole('button', { name: 'Plot options', exact: true }).click();
  await expect(options.getByRole('radio', { name: 'Percent change', exact: true })).toBeDisabled();
  await options.getByRole('radio', { name: 'Value', exact: true }).check();
  await page.keyboard.press('Escape');
  const bounds = await panel.locator('.results-toolbar').evaluate(element => {
    const row = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll('select, button')].filter(control => control.checkVisibility());
    return { fits: element.scrollWidth <= element.clientWidth, oneRow: controls.every(control => {
      const box = control.getBoundingClientRect(); return box.top >= row.top && box.bottom <= row.bottom && Math.abs((box.top + box.bottom) / 2 - (row.top + row.bottom) / 2) < 1;
    }) };
  });
  expect(bounds).toEqual({ fits: true, oneRow: true });
  await panel.getByRole('button', { name: 'Close results', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Solver', exact: true })).toBeFocused();
});

test('table keeps identity while scrolling and removes repeated chrome without changing exact values', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const value = structuredClone(fixture);
  value.buses[0]!.init.Vr = 0.77673471656;
  await page.locator('input[type=file]').setInputFiles({
    name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toHaveCount(0);
  await expect(page.locator('.vt__footer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Table class', exact: true }).click();
  await page.getByRole('button', { name: 'Bus', exact: true }).click();
  const grid = page.getByRole('grid', { name: 'Bus', exact: true });
  await expect(grid.getByRole('gridcell', { name: 'Bus', exact: true })).toHaveCount(0);
  await grid.evaluate(element => { element.scrollLeft = 400; });
  const identity = grid.locator('[data-part=identity]').first();
  expect((await identity.boundingBox())!.x).toBe((await grid.boundingBox())!.x);
  const numeric = grid.locator('[title="0.77673471656"]');
  await expect(numeric).toHaveText('0.776735');
  await page.getByRole('searchbox', { name: 'Search elements' }).fill('North');
  await expect(page.locator('.match-count')).toHaveText('1 match');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('.match-count')).toHaveCount(0);
});
