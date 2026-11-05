import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };
import { completedRun } from './fixtures/completed-run.js';

async function accessible(page: Page, surface: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect.soft(result.violations.map(issue => ({ rule: issue.id, impact: issue.impact, elements: issue.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) })), surface).toEqual([]);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test('accessible views and dialogs in ' + colorScheme, async ({ page }) => {
    test.setTimeout(120_000);
    page.on('dialog', dialog => dialog.accept());
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: colorScheme === 'light' ? 1440 : 390, height: 900 });
    await page.route('**/api/library/**', route => route.fulfill({ json: [{ name: 'Example.case.json', is_dir: false, size: 1024 }] }));
    await page.goto('/');
    await accessible(page, 'Welcome');
    await page.getByRole('button', { name: /Open from library/ }).click();
    await expect(page.getByRole('button', { name: 'Example', exact: true })).toBeVisible();
    await accessible(page, 'Library');
    await page.getByRole('button', { name: 'Close library', exact: true }).click();
    await page.getByLabel('Open case file', { exact: true }).setInputFiles({ name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await accessible(page, 'Network');
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await accessible(page, 'Table');
    await page.getByRole('button', { name: 'Table class', exact: true }).click();
    await accessible(page, 'Class picker');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await accessible(page, 'Columns');
    await page.keyboard.press('Escape');
    await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
    await accessible(page, 'Element properties');
    await page.getByRole('button', { name: 'Close element', exact: true }).click();
    await page.getByRole('button', { name: 'GridKit menu', exact: true }).click();
    await accessible(page, 'GridKit commands');
    await page.getByRole('menuitem', { name: 'Case information', exact: true }).click();
    await accessible(page, 'Case properties');
    await page.getByRole('button', { name: 'Close case information', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await accessible(page, 'Settings');
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    if (await settings.getByRole('combobox', { name: 'Settings section', exact: true }).isVisible()) await settings.getByRole('combobox', { name: 'Settings section', exact: true }).selectOption({ label: 'Network mappings' });
    else await settings.getByRole('button', { name: 'Network mappings', exact: true }).click();
    await accessible(page, 'View mappings');
    await settings.getByRole('radio', { name: 'Browser defaults', exact: true }).check();
    await accessible(page, 'Browser mappings');
    await settings.getByRole('button', { name: 'Color mapping', exact: true }).click();
    const mapping = page.getByRole('dialog', { name: 'Color mapping', exact: true });
    await mapping.getByRole('button', { name: /^Nominal voltage/ }).click();
    await accessible(page, 'Mapping fields and palettes');
    await page.keyboard.press('Escape');
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Solver', exact: true }).click();
    await page.getByRole('button', { name: 'Solver options', exact: true }).click();
    await accessible(page, 'Solver commands');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add bus fault', exact: true }).click();
    await page.getByRole('combobox', { name: 'Event 1 bus', exact: true }).click();
    await accessible(page, 'Event target picker');
    await page.keyboard.press('Escape');
    await accessible(page, 'Solver events');
    await page.getByLabel('Event 1 reactance (p.u.)', { exact: true }).fill('0');
    await accessible(page, 'Solver validation');
  });

  test('accessible results and export in ' + colorScheme, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'This runner has no WebGPU adapter for result ingestion and export.');
    test.setTimeout(120_000);
    await completedRun(page);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: colorScheme === 'light' ? 1440 : 390, height: 900 });
    await page.goto('/');
    await page.getByLabel('Open case file', { exact: true }).setInputFiles({ name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await page.getByRole('button', { name: 'Solver', exact: true }).click();
    await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled();
    const results = page.getByRole('region', { name: 'Simulation', exact: true });
    await expect(results.locator('canvas')).toHaveAttribute('aria-busy', 'false');
    await accessible(page, 'Results');
    await results.getByRole('button', { name: 'Plot options', exact: true }).click();
    await accessible(page, 'Plot options');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Network', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await accessible(page, 'Image export');
    await page.getByRole('tab', { name: 'Video', exact: true }).click();
    await accessible(page, 'Video export');
  });
}
