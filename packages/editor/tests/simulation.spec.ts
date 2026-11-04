import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import fixture from '../../../library/IEEE39.case.json' with { type: 'json' };
import small from '../../library/test/small.case.json' with { type: 'json' };
import { completedRun } from './fixtures/completed-run.js';

async function openCase(page: Page, value: unknown = fixture) {
  await page.goto('/');
  await page.getByLabel('Open case file', { exact: true }).setInputFiles({
    name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
}
async function options(page: Page, name: string) {
  await page.getByRole('button', { name: 'Solver options', exact: true }).click();
  await page.getByRole('dialog', { name: 'Solver options', exact: true }).getByRole('button', { name, exact: true }).click();
}

async function contextMenu(cell: Locator) {
  await cell.click();
  await cell.press('Shift+F10');
}

test('one Solver view preserves drafts, validates all settings and round trips solver files', async ({ page }) => {
  const requests: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/api(\/|$)/, async route => { requests.push(new URL(route.request().url()).pathname); await route.fulfill({ status: 404 }); });
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await openCase(page);
  const search = page.getByRole('searchbox', { name: 'Search elements', exact: true });
  await search.fill('16');
  await contextMenu(page.getByRole('gridcell', { name: '16', exact: true }).first());
  await expect(page.getByRole('menuitem', { name: 'Simulate fault', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'More…', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Solver', exact: true });
  await expect(page.getByRole('button', { name: 'Solver', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(settings.getByRole('heading', { name: 'Solver', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Event 1 bus', exact: true })).toContainText('16');
  await page.getByLabel('Duration', { exact: true }).fill('2');
  await page.getByLabel('Output interval', { exact: true }).fill(String(1 / 240));
  await page.getByLabel('Event 1 reactance (p.u.)', { exact: true }).fill('0');
  await expect(settings.getByRole('alert')).toContainText('cannot both be zero');
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await settings.getByRole('button', { name: 'Review solver edits', exact: true }).click();
  await expect(page.getByLabel('Event 1 resistance (p.u.)', { exact: true })).toBeFocused();
  await page.getByLabel('Event 1 reactance (p.u.)', { exact: true }).fill('0.02');
  await page.getByLabel('Event 1 resistance (p.u.)', { exact: true }).fill('0.001');
  await page.getByRole('combobox', { name: 'Event 1 bus', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find buses', exact: true }).fill('16');
  await page.getByRole('dialog', { name: 'Event 1 bus', exact: true }).getByRole('gridcell', { name: '16', exact: true }).first().click();
  for (const [label, value] of [['Relative tolerance', '0.0000001'], ['Absolute tolerance', '0.000000001'], ['Integration step', '0'], ['Maximum steps', '100000'], ['Maximum order', '5']])
    await page.getByLabel(label!, { exact: true }).fill(value!);
  await page.getByLabel('Initialization', { exact: true }).selectOption('ya_ydp');
  const downloaded = page.waitForEvent('download');
  await options(page, 'Download solver settings');
  const file = await downloaded;
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(file.suggestedFilename()).toMatch(/\.solver\.json$/);
  expect(exported).toMatchObject({ tmax: 2, rel_tol: 1e-7, abs_tol: 1e-9, dt_fixed: 0, max_steps: 100000, max_order: 5, consistent_ic_type: 'ya_ydp' });
  expect(exported.events[0]).toMatchObject({ bus: 16, R: 0.001, X: 0.02 });
  await page.getByLabel('Import solver file', { exact: true }).setInputFiles({ name: 'settings.solver.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(settings.getByText('Settings imported for the current case.', { exact: true })).toBeVisible();
  await settings.getByText('JSON', { exact: true }).click();
  await page.getByLabel('Solver JSON', { exact: true }).fill('{');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByLabel('Solver JSON', { exact: true })).toHaveValue('{');
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Apply JSON changes', exact: true }).click();
  await expect(settings.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Discard JSON changes', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'Solver', exact: true })).toBeFocused();
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const branch = fixture.devices.find(device => device.class === 'Branch')!;
  await search.fill(String(branch.id));
  await contextMenu(page.getByRole('gridcell', { name: String(branch.id), exact: true }).first());
  await page.getByRole('menuitem', { name: 'More…', exact: true }).click();
  await expect(page.getByLabel('Event 1 action', { exact: true })).toHaveValue('out_of_service');
  await expect(page.getByRole('combobox', { name: 'Event 1 line', exact: true })).toContainText(String(branch.id));
  await expect(settings.getByRole('button', { name: /^Event 2:/ })).toHaveCount(0);
  await page.getByLabel('Event 1 action', { exact: true }).selectOption('in_service');
  await options(page, 'Discard edits');
  await settings.getByRole('button', { name: /^Event 2:/ }).click();
  await expect(page.getByLabel('Event 2 action', { exact: true })).toHaveValue('fault_off');
  await expect(page.getByLabel('Relative tolerance', { exact: true })).toHaveValue('1e-7');
  await expect(page.getByRole('button', { name: 'Run simulation', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Simulation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
  await expect(preferences.getByRole('button', { name: 'Solver', exact: true })).toHaveCount(0);
  await preferences.getByRole('searchbox').fill('relative tolerance');
  await expect(preferences.getByText('No preferences found.', { exact: true })).toBeVisible();
  await preferences.getByRole('button', { name: 'Cancel', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Open case file', { exact: true }).setInputFiles({ name: 'replacement.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('10');
  await expect(page.getByLabel('Event 1 action', { exact: true })).toHaveCount(0);
  expect(new Set(requests)).toEqual(new Set(['/api/solver/', '/api/library/']));
  expect(errors).toEqual([]);
});

test('pending Solver edits survive navigation and guard quick simulations without changing the case', async ({ page, browserName }) => {
  const submitted = await completedRun(page);
  const studies: unknown[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().endsWith('/runs')) return;
    const json = request.postData()?.match(/name="solver"[^]*?\r\n\r\n([^]*?)\r\n--/)?.[1];
    if (json) studies.push(JSON.parse(json));
  });
  await openCase(page, small);
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await page.getByLabel('Duration', { exact: true }).fill('3');
  // Global editor shortcuts cannot mutate the selected case from the Solver page.
  await page.getByRole('heading', { name: 'Solver', exact: true }).focus();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const cell = page.getByRole('gridcell', { name: 'North', exact: true });
  await contextMenu(cell);
  page.once('dialog', async dialog => { expect(dialog.message()).toBe('Discard unapplied solver edits?'); await dialog.dismiss(); });
  await page.getByRole('menuitem', { name: 'Simulate fault', exact: true }).click();
  expect(submitted()).toBe(0);
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByLabel('Duration', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await contextMenu(cell);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('menuitem', { name: 'Simulate fault', exact: true }).click();
  if (browserName === 'webkit') {
    // This runner cannot initialize the existing GPU-backed result ingestion.
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('alert')).toContainText('no GPU adapter');
    await page.getByRole('button', { name: 'Solver', exact: true }).click();
    await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('3');
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
    return;
  }
  await expect.poll(submitted).toBe(1);
  expect(studies[0]).toMatchObject({ tmax: 3, events: [{ type: 'fault_on' }, { type: 'fault_off' }] });
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await page.getByLabel('Duration', { exact: true }).fill('5');
  expect(studies[0]).toMatchObject({ tmax: 3 });
  await page.getByRole('button', { name: 'Close results', exact: true }).click();
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect.poll(submitted).toBe(2);
  expect(studies[1]).toMatchObject({ tmax: 5 });
});
