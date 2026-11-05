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
  await page.getByRole('menu', { name: 'Solver options', exact: true }).getByRole('menuitem', { name, exact: true }).click();
}

async function contextMenu(cell: Locator) {
  await cell.click();
  await cell.press('Shift+F10');
}


test('solver fields and JSON take effect immediately, persist across navigation and export unchanged case data', async ({ page }) => {
  const errors: string[] = [], prompts: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await openCase(page);
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  const form = page.getByRole('region', { name: 'Solver', exact: true });
  await page.getByLabel('Duration', { exact: true }).fill('12');
  await page.getByLabel('Relative tolerance', { exact: true }).fill('0.0000001');
  await page.getByRole('button', { name: 'Add bus fault', exact: true }).click();
  await page.getByLabel('Event 1 time (s)', { exact: true }).fill('3');
  await page.getByLabel('Event 2 time (s)', { exact: true }).fill('4');
  await expect(page.locator('.app-header').getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('12');
  const json = page.getByLabel('Solver JSON', { exact: true });
  if (!await json.isVisible()) await form.getByRole('button', { name: 'JSON', exact: true }).click();
  const current = JSON.parse(await json.inputValue());
  await json.fill(JSON.stringify({ ...current, tmax: 15 }));
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('15');
  const download = page.waitForEvent('download');
  await options(page, 'Download solver settings');
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(saved).toMatchObject({ tmax: 15, rel_tol: 1e-7 });
  expect(saved.events[0]).toMatchObject({ time: 3, type: 'fault_on' });
  await json.fill('{ invalid');
  await expect(json).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('alert')).toContainText('Enter valid JSON');
  await expect(page.getByRole('button', { name: 'Run simulation', exact: true })).toBeDisabled();
  await json.fill(JSON.stringify(saved));
  await expect(json).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /Apply JSON|Discard JSON/ })).toHaveCount(0);
  await page.getByLabel('Import solver file').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tmax: 7, dt_monitor: 0.01 })) });
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('7');
  await options(page, 'Reset solver settings');
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('10');
  expect(prompts).toEqual([]);
  expect(errors).toEqual([]);
});

test('context simulations use current settings without confirmations and preserve the running snapshot', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'This runner cannot initialize GPU-backed result ingestion.');
  const submitted = await completedRun(page), studies: { tmax: number }[] = [], prompts: string[] = [];
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().endsWith('/runs')) return;
    const json = request.postData()?.match(/name="solver"[^]*?\r\n\r\n([^]*?)\r\n--/)?.[1];
    if (json) studies.push(JSON.parse(json));
  });
  await openCase(page, small);
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await page.getByLabel('Duration', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await contextMenu(page.getByRole('gridcell', { name: 'North', exact: true }));
  await page.getByRole('menuitem', { name: 'Simulate fault', exact: true }).click();
  await expect.poll(submitted).toBe(1);
  expect(studies[0]).toMatchObject({ tmax: 4 });
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('4');
  await page.getByLabel('Duration', { exact: true }).fill('5');
  expect(studies[0]).toMatchObject({ tmax: 4 });
  await expect(page.getByRole('button', { name: 'Run simulation', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect.poll(submitted).toBe(2);
  expect(studies[1]).toMatchObject({ tmax: 5 });
  expect(prompts).toEqual([]);
});

test('Run becomes Stop at a fixed width and cancels the run', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'This runner cannot initialize GPU-backed result ingestion.');
  const submitted = await completedRun(page);
  let cancelled = false;
  await page.route(url => url.pathname === '/api/solver/runs/harden-test' || url.pathname === '/api/solver/runs/harden-test/cancel', route => {
    if (route.request().url().endsWith('/cancel')) { cancelled = true; return route.fulfill({ status: 204 }); }
    return route.fulfill({ json: { sequence: cancelled ? 2 : 1, state: cancelled ? 'cancelled' : 'running', rows: 0, range: null } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCase(page, small);
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  const run = page.getByRole('button', { name: 'Run simulation', exact: true });
  const duration = page.getByLabel('Duration', { exact: true });
  const more = page.getByRole('button', { name: 'Solver options', exact: true });
  await expect(run).toBeEnabled();
  const baseline = await Promise.all([run, duration, more].map(control => control.boundingBox()));
  await run.click();
  const stop = page.getByRole('button', { name: 'Stop simulation', exact: true });
  await expect(stop).toBeEnabled();
  expect(await Promise.all([stop, duration, more].map(control => control.boundingBox()))).toEqual(baseline);
  await expect(page.getByRole('region', { name: 'Simulation', exact: true }).getByRole('button', { name: 'Stop simulation', exact: true })).toHaveCount(0);
  await expect.poll(submitted).toBe(1);
  await stop.click();
  await expect.poll(() => cancelled).toBe(true);
  await expect(run).toBeEnabled();
  expect(await Promise.all([run, duration, more].map(control => control.boundingBox()))).toEqual(baseline);
});

test('solver connection recovery uses shared notifications and keeps menu items fixed', async ({ page }) => {
  await page.route('**/config.json', route => route.fulfill({ json: {} }));
  let offline = true;
  await page.route('**/api/solver/', route => offline
    ? route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Solver offline.' } })
    : route.fulfill({ status: 204 }));
  await openCase(page, small);
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  const notice = page.getByRole('region', { name: 'Notifications' });
  await expect(notice.getByRole('alert')).toContainText('Solver offline.');
  const run = page.getByRole('button', { name: 'Run simulation', exact: true });
  const bounds = await run.boundingBox();
  await page.getByRole('button', { name: 'Solver options', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Solver options', exact: true });
  const retry = menu.getByRole('menuitem', { name: 'Retry connection', exact: true });
  await expect(retry).toBeEnabled();
  const labels = await menu.getByRole('menuitem').allTextContents();
  const reset = await menu.getByRole('menuitem', { name: 'Reset solver settings', exact: true }).boundingBox();
  await page.keyboard.press('Escape');
  offline = false;
  await notice.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(run).toBeEnabled();
  expect(await run.boundingBox()).toEqual(bounds);
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Solver options', exact: true }).click();
  await expect(retry).toBeDisabled();
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual(labels);
  expect(await menu.getByRole('menuitem', { name: 'Reset solver settings', exact: true }).boundingBox()).toEqual(reset);
});

test('a new run clears the previous run failure even when started from the header', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'This runner has no WebGPU adapter to start a simulation.');
  await completedRun(page);
  let failed = false;
  await page.route('**/api/solver/runs/harden-test?*', route => {
    if (failed) return route.fallback();
    failed = true;
    return route.fulfill({ json: { sequence: 1, state: 'failed', rows: 0, range: null, error: { code: 'simulation', message: 'Test run failed.' } } });
  });
  await openCase(page, small);
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Test run failed.');
  await expect(page.getByRole('region', { name: 'Simulation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Simulation', exact: true })).toBeVisible();
});
