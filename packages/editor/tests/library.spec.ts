import { test, expect, type Page } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };

/** Every service's first answer is in, so the welcome page shows what is there. */
const settled = (page: Page) => page.waitForFunction(() => performance.getEntriesByName('gridkit:services').length);

// A plain file library needs no metadata. Tests can publish it with a later route.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/library/library.json', route => route.fulfill({ status: 404 }));
});

test('one list marks favorites without delaying browsing or changing its order and bounds', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const reads: string[] = [];
  let release!: () => void;
  const metadata = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/library/**', async route => {
    const path = new URL(route.request().url()).pathname;
    reads.push(path);
    if (path === '/api/library/library.json') {
      await metadata;
      return route.fulfill({ json: { favorites: ['Nested/example.case.json', 'Other.case.json', 'missing.case.json', 'Other.case.json'] } });
    }
    if (path === '/api/library/') return route.fulfill({ json: [
      { name: 'Nested/', is_dir: true, size: 0 }, { name: 'Other.case.json', is_dir: false, size: 9999 },
      { name: 'Unavailable.case.json', is_dir: false, size: 100 },
      { name: 'library.json', is_dir: false, size: 100 },
    ] });
    if (path === '/api/library/Nested/') return route.fulfill({ json: [{ name: 'example.case.json', is_dir: false, size: 1426 }] });
    if (path === '/api/library/Nested/example.case.json') return route.fulfill({ json: fixture });
    return route.fulfill({ status: 404, json: { code: 'missing', message: 'The library has no such file.' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open from library…', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Library', exact: true });
  const rows = library.locator('.library__entry');
  const search = library.getByRole('searchbox', { name: 'Find a case' });
  await expect(rows).toHaveText(['Nested', 'Other', 'Unavailable']);
  const bounds = await library.boundingBox();
  await expect(search).toBeEnabled();
  await expect(library.getByRole('group', { name: 'Library view' })).toHaveCount(0);
  await expect(library.getByRole('button', { name: 'Close library' })).toBeFocused();
  release();
  await expect(library.getByRole('button', { name: 'Other', exact: true })).toHaveAccessibleDescription('Favorite');
  await expect(rows).toHaveText(['Nested', 'Other', 'Unavailable']);
  await expect(rows.filter({ has: page.locator('svg') })).toHaveCount(3);
  await expect(library.getByRole('button', { name: 'missing', exact: true })).toHaveCount(0);
  expect(reads.every(path => path === '/api/library/' || path === '/api/library/library.json')).toBe(true);
  expect(await library.boundingBox()).toEqual(bounds);
  await library.getByRole('button', { name: 'Unavailable', exact: true }).click();
  await expect(library.getByRole('alert')).toHaveText('The library has no such file.');
  expect(await library.boundingBox()).toEqual(bounds);
  await library.getByRole('button', { name: 'Nested', exact: true }).click();
  await expect(library.getByRole('group', { name: 'Find a case', exact: true })).toBeFocused();
  await expect(rows).toHaveText(['example']);
  await expect(rows).toHaveAccessibleDescription('Favorite');
  await expect(library.getByRole('alert')).toHaveCount(0);
  await expect(library.getByRole('navigation', { name: 'Folder' })).toContainText('Nested');
  expect(await library.boundingBox()).toEqual(bounds);
  expect(await library.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await library.textContent()).not.toContain('·');
  await search.fill('no matching case');
  await expect(library.getByText('No matching cases.')).toBeVisible();
  expect(await library.boundingBox()).toEqual(bounds);
  await search.fill('example');
  await expect(rows).toHaveText(['example']);
  await search.press('Enter');
  await expect(library).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Case information:/ })).toHaveText(fixture.header.case_name);
});

test('invalid favorites leave browsing usable and a later library open reads corrected metadata', async ({ page }) => {
  let info: unknown = { favorites: ['../example.case.json'] };
  await page.route('**/api/library/library.json', route => route.fulfill({ json: info }));
  await page.route('**/api/library/', route => route.fulfill({ json: [{ name: 'example.case.json', is_dir: false, size: 100 }] }));
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Open from library…', exact: true });
  await open.click();
  const library = page.getByRole('dialog', { name: 'Library', exact: true });
  await expect(library.getByRole('alert')).toContainText('Favorites could not be read from library.json.');
  await expect(library.locator('.library__entry')).toHaveText(['example']);
  await expect(library.getByRole('group', { name: 'Library view' })).toHaveCount(0);
  await library.getByRole('button', { name: 'Close library' }).click();
  info = { favorites: ['example.case.json'] };
  await open.click();
  await expect(library.getByRole('button', { name: 'example', exact: true })).toHaveAccessibleDescription('Favorite');
  await expect(library.getByRole('alert')).toHaveCount(0);
});

test('library opens for browsing without focusing search, and fits above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 810, height: 1080 });
  await page.route('**/api/library/', route => route.fulfill({ json: Array.from({ length: 40 }, (_, index) => ({
    name: `Case ${index}.case.json`, size: 1426, is_dir: false,
  })) }));
  await page.goto('/');
  await page.getByRole('button', { name: /Open from library/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Library', exact: true });
  const search = dialog.getByRole('searchbox', { name: 'Find a case' });
  await expect(dialog.getByRole('listitem')).toHaveCount(40);
  const bounds = await dialog.boundingBox();
  await expect(search).not.toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Close library' })).toBeFocused();
  await expect(dialog.locator('.library__entry').first()).toBeInViewport();
  await dialog.locator('.library__entry').last().scrollIntoViewIfNeeded();
  await expect(dialog.locator('.library__entry').last()).toBeInViewport();
  await expect(search).toBeInViewport();
  await search.fill('Case 39');
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  expect(await dialog.boundingBox()).toEqual(bounds);

  // The iPad keyboard changes visualViewport while the layout viewport stays put.
  // Desktop automation cannot open the OS keyboard; exercise those events explicitly.
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 420 },
      offsetTop: { configurable: true, value: 80 },
    });
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 80 && bounds.bottom <= 500;
  })).toBe(true);
  await expect(dialog.locator('.library__entry')).toBeInViewport();
  await expect(search).toBeFocused();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Reflect.deleteProperty(viewport, 'height');
    Reflect.deleteProperty(viewport, 'offsetTop');
    viewport.dispatchEvent(new Event('resize'));
  });
  await dialog.getByRole('button', { name: 'Close library' }).click();
  await expect(page.getByRole('button', { name: /Open from library/ })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Welcome', exact: true })).toBeVisible();
});

test('an editor without a library offers none', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await expect(page.getByRole('button', { name: 'Open file…', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open from library…', exact: true })).toHaveCount(0);
});

test('finds a case in a folder of the library and opens it as any file opens', async ({ page }) => {
  await page.route('**/api/library/', route => route.fulfill({ json: [
    { name: 'IEEE/', size: 0, is_dir: true },
    { name: 'Another.case.json', size: 2000, mod_time: '2026-11-01T00:00:00Z', is_dir: false },
    { name: 'README.txt', size: 100, is_dir: false },
  ] }));
  await page.route('**/api/library/IEEE/', route => route.fulfill({ json: [{ name: 'Small example.case.json', size: 1426, is_dir: false }] }));
  await page.route('**/api/library/IEEE/Small%20example.case.json', route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open from library…', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Library', exact: true });
  await expect(library.getByRole('listitem')).toHaveCount(2);
  await library.getByRole('button', { name: /^IEEE/ }).click();
  await expect(library.getByRole('navigation', { name: 'Folder' })).toContainText('IEEE');
  await expect(library.getByRole('listitem')).toHaveText([/Small example/]);
  await library.getByRole('searchbox', { name: 'Find a case' }).fill('small');
  await library.getByRole('searchbox', { name: 'Find a case' }).press('Enter');
  await expect(library).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Case information:/ })).toHaveText(fixture.header.case_name);
});

test("shows a library that cannot be reached in the words given, and lists it once it answers", async ({ page }) => {
  let reachable = false;
  await page.route('**/api/library/', route => reachable ? route.fulfill({ json: [] })
    : route.fulfill({ status: 502, json: { code: 'unavailable', message: 'Cannot reach the library service at https://library.example.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open from library…', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Library', exact: true });
  await expect(library.getByRole('alert')).toHaveText(/Cannot reach the library service at https:\/\/library\.example\./);
  reachable = true;
  await library.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(library.getByText('No cases here.')).toBeVisible();
  await library.getByRole('button', { name: 'Close library' }).click();
  await expect(page.getByRole('button', { name: 'Open from library…', exact: true })).toBeFocused();
});

test('closing the library while a case downloads opens nothing later', async ({ page }) => {
  await page.route('**/api/library/', route => route.fulfill({ json: [{ name: 'example.case.json', size: 1426, is_dir: false }] }));
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/library/example.case.json', async route => {
    await waiting;
    await route.fulfill({ json: fixture }).catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open from library…', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Library', exact: true });
  const download = page.waitForRequest('**/api/library/example.case.json');
  await library.getByRole('button', { name: /^example/ }).click();
  await download;
  await library.getByRole('button', { name: 'Close library' }).click();
  release();
  await expect(page.getByRole('region', { name: 'Welcome', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Case information:/ })).toHaveCount(0);
});
