import { test, expect } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };

test('Library is primary, Open file stays available, and returning home restores focus', async ({ page }) => {
  await page.route('**/api/library/', route => route.fulfill({ json: [{ name: 'example.case.json', size: 1426, is_dir: false }] }));
  await page.route('**/api/library/example.case.json', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  const actions = page.getByRole('group', { name: 'Get started' });
  const library = actions.getByRole('button', { name: 'Open from library…', exact: true });
  await expect(library).toBeEnabled();
  await expect(actions.getByRole('button')).toHaveText(['Open from library…', 'Open file…']);
  await expect(library).toHaveClass(/primary/);
  await expect(actions.getByRole('button', { name: 'Open file…', exact: true })).not.toHaveClass(/primary/);
  await expect(page.getByRole('button', { name: 'New case', exact: true })).toHaveCount(0);
  await library.press('Enter');
  await page.getByRole('dialog', { name: 'Library', exact: true }).getByRole('button', { name: /^example/ }).click();
  await page.getByRole('button', { name: 'GridKit menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Case information', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(fixture.header.case_name);
  await page.getByRole('button', { name: 'Close case information', exact: true }).click();
  await page.getByRole('button', { name: 'GridKit menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Return home', exact: true }).click();
  await expect(library).toBeFocused();
});

test('opening files does not require browser storage', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Storage unavailable'); } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open file…', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({ name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: 'GridKit menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Case information', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(fixture.header.case_name);
  await page.getByRole('button', { name: 'Close case information', exact: true }).click();
});

test('welcome defers graphics, results workers and optional panels until needed', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.route('**/config.json', route => route.fulfill({ json: {} }));
  await page.route('**/api/**', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  await page.waitForFunction(() => performance.getEntriesByName('gridkit:services').length > 0);
  await expect(page.getByRole('region', { name: 'Welcome', exact: true })).toBeVisible();
  expect(requests.filter(path => /\.wasm$|\.bin$|results\.worker|PreferencesDialog-|ExportDialog-|SolverSettings-|ResultsDock-|NetworkView-/.test(path))).toEqual([]);
  await page.getByLabel('Open case file', { exact: true }).setInputFiles({ name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toBeVisible();
  expect(requests.some(path => /SolverSettings-/.test(path))).toBe(true);
});

test('a page whose files were replaced since it opened says so, and offers the page that has them', async ({ page }) => {
  await page.route('**/config.json', route => route.fulfill({ json: {} }));
  await page.route('**/api/**', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  await page.getByLabel('Open case file', { exact: true }).setInputFiles({ name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  // Redeploy: the index names a new entry script and old chunks 404.
  await page.route(url => url.pathname === '/', route => route.request().isNavigationRequest() ? route.continue()
    : route.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="module" src="./assets/index-next.js"></script>' }));
  await page.route('**/assets/SolverSettings-*', route => route.fulfill({ status: 404 }));
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'GridKit Web was updated since this page opened.' })).toHaveCount(1);
  const reloaded = page.waitForRequest(request => request.isNavigationRequest());
  await page.getByRole('button', { name: 'Reload application', exact: true }).click();
  await reloaded;
  await expect(page.getByRole('alert')).toHaveCount(0);
});
