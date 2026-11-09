import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };
import emptyFixture from './fixtures/empty.case.json' with { type: 'json' };
import { defaults, geographyOf } from '../src/preferences/definitions.js';

// Compare the native case separately from the UI's persisted identity/layout metadata.
function nativeCase(value: typeof fixture) {
  const native = (row: Record<string, unknown>) => {
    const { $ui: _metadata, ...fields } = row;
    return fields;
  };
  return { ...value, buses: value.buses.map(native), devices: value.devices.map(native), signals: value.signals.map(native) };
}

async function openCase(page: Page, value: { readonly header: { readonly case_name: string }; readonly [key: string]: unknown } = fixture) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'example.case.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await showCaseInfo(page);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(value.header.case_name);
  await navigate(page, 'Table');
}

async function showCaseInfo(page: Page) {
  if (!await page.getByRole('dialog', { name: 'Case information', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'GridKit menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Case information', exact: true }).click();
  }
}

async function selectClass(page: Page, key: string, label = 'Table class') {
  await page.getByRole('button', { name: label, exact: true }).click();
  const name = key ? JSON.parse(key)[1] as string : 'All classes';
  await page.getByRole('dialog', { name: label, exact: true }).getByRole('button', { name, exact: true }).click();
}

async function preferenceSection(page: Page, label: string) {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  const selector = dialog.getByRole('combobox', { name: 'Settings section', exact: true });
  if (await selector.isVisible()) await selector.selectOption({ label });
  else await dialog.getByRole('button', { name: label, exact: true }).click();
}

async function navigate(page: Page, section: string) {
  if (section === 'Info') { await showCaseInfo(page); return; }
  const close = page.getByRole('button', { name: 'Close case information', exact: true });
  if (await close.isVisible()) await close.click();
  if (['Buses', 'Devices', 'Signals'].includes(section)) {
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    const key = section === 'Buses' ? JSON.stringify(['buses', 'Bus']) : section === 'Signals' ? JSON.stringify(['signals', 'Signal']) : '';
    await selectClass(page, key);
  } else {
    await page.getByRole('button', { name: section, exact: true }).click();
  }
}

async function fileAction(page: Page, name: string) {
  if (name === 'Download case') await showCaseInfo(page);
  await page.getByRole('button', { name, exact: true }).click();
  if (name === 'Download case') {
    const unfinished = page.getByRole('button', { name: 'Download unfinished case', exact: true });
    if (await unfinished.isVisible()) await unfinished.click();
    const close = page.getByRole('button', { name: 'Close case information' });
    if (await close.isVisible()) await close.click();
  }
}

async function openEmptyCase(page: Page) {
  if (await page.getByRole('button', { name: 'GridKit menu', exact: true }).isVisible()) {
    const close = page.getByRole('button', { name: 'Close case information', exact: true });
    if (await close.isVisible()) await close.click();
    await page.getByRole('button', { name: 'GridKit menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Return home', exact: true }).click();
  }
  await openCase(page, emptyFixture);
  await showCaseInfo(page);
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  // A test cannot answer the browser's save picker, so saves take the download path.
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  for (const url of geographyOf(defaults))
    await page.route(url, route => route.fulfill({ path: fileURLToPath(new URL('fixtures/borders.geojson', import.meta.url)), contentType: 'application/geo+json' }));
  await page.goto('./');
});

test('empty cases can be inspected without authoring controls', async ({ page }) => {
  await openCase(page, emptyFixture);
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Add model', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete selected element', exact: true })).toHaveCount(0);
  await expect(page.getByRole('grid', { name: 'All classes', exact: true })).toBeVisible();
});

test('case details and keyboard commands preserve the downloaded case', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', "Playwright's WebKit goes back a page on Backspace.");
  await openCase(page);
  await showCaseInfo(page);
  const info = page.getByRole('dialog', { name: 'Case information', exact: true });
  for (const input of await info.locator('input, textarea').all()) await expect(input).toHaveAttribute('readonly', '');
  await expect(info.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await info.getByRole('button', { name: 'Close', exact: true }).click();
  const grid = page.getByRole('grid', { name: 'Bus', exact: true });
  await grid.getByRole('gridcell', { name: 'North', exact: true }).click();
  for (const key of ['Delete', 'Backspace', 'Control+z', 'Control+Shift+z']) await grid.press(key);
  await expect(grid.getByRole('gridcell', { name: 'North', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await fileAction(page, 'Download case');
  const saved = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(nativeCase(saved)).toEqual(fixture);
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

test('table defaults to Bus with header controls and read-only element properties', async ({ page }) => {
  await openCase(page);
  const header = page.locator('.app-header');
  await expect(header.getByRole('button', { name: 'Table class', exact: true })).toContainText('Bus');
  await expect(header.getByRole('button', { name: 'Columns', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Case table' }).getByRole('button', { name: 'Columns', exact: true })).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Search elements' });
  await search.fill('North');
  await search.press('ArrowDown');
  await page.getByRole('grid', { name: 'Bus', exact: true }).press('Enter');
  const bus = page.getByRole('dialog', { name: 'Bus 1', exact: true });
  await expect(bus.getByLabel('Element name')).toHaveValue('North');
  for (const input of await bus.locator('input, textarea').all()) await expect(input).toHaveAttribute('readonly', '');
  await expect(bus.getByRole('button', { name: /Apply|Delete/ })).toHaveCount(0);
  await bus.getByRole('button', { name: 'Close', exact: true }).click();
  await search.fill('');
  await selectClass(page, JSON.stringify(['devices', 'Branch']));
  await page.getByRole('gridcell', { name: 'line-1', exact: true }).dblclick();
  const branch = page.getByRole('dialog', { name: 'Branch line-1', exact: true });
  await expect(branch.getByLabel('From bus', { exact: true })).toHaveAttribute('readonly', '');
  await expect(branch.getByLabel('To bus', { exact: true })).toHaveAttribute('readonly', '');
  await expect(branch.getByRole('combobox')).toHaveCount(0);
  await branch.getByRole('button', { name: 'Close', exact: true }).click();
  await selectClass(page, '');
  await search.fill('future-1');
  await page.getByRole('gridcell', { name: 'future-1', exact: true }).dblclick();
  const unknown = page.getByRole('dialog', { name: 'FutureDevice future-1' });
  for (const input of await unknown.locator('input, textarea').all()) await expect(input).toHaveAttribute('readonly', '');
});

test('renderer selection and view switching', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openCase(page);
  await navigate(page, 'Network');
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true');
  // A pixel-clamped unit radius must not inflate the first geographic fit to several degrees.
  const span = await page.getByLabel('Network view').evaluate((canvas: HTMLCanvasElement) => {
    // latkit copies each frame into the canvas's 2D context.
    const { width, height } = canvas, rgba = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    let first = height, last = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4, r = rgba[offset]!, g = rgba[offset + 1]!, b = rgba[offset + 2]!;
      if (g > r * 1.2 && b > r * 1.2 && Math.abs(g - b) < 30) { first = Math.min(first, y); last = Math.max(last, y); }
    }
    return (last - first) / height;
  });
  expect(span).toBeGreaterThan(0.4);
  await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Globe', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await navigate(page, 'Table');
  await page.getByRole('searchbox', { name: 'Search elements' }).fill('North');
  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  await expect(page.getByLabel('Element name')).toHaveValue('North');
  await page.getByRole('button', { name: 'Close element' }).click();
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-current', 'page');
  await navigate(page, 'Table');
  await expect(page.getByRole('row', { selected: true })).toContainText('North');
  await navigate(page, 'Network');
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await openCase(page, { ...fixture, buses: fixture.buses.map(bus => ({
    ...bus, extension: { ...bus.extension, latitude: 200 },
  })) });
  await navigate(page, 'Network');
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Globe unavailable' })).toContainText('geographic bus coordinates');
  await page.keyboard.press('Escape');
  expect(failures).toEqual([]);
});

test('exports a picture of the view as previewed, its choices kept for the next', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openCase(page);
  await navigate(page, 'Network');
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(dialog.getByRole('tab', { name: 'Image' })).toBeFocused();
  // Without a run there is only a picture to make, and Video says why.
  await dialog.getByRole('tab', { name: 'Video' }).click();
  await expect(dialog.getByRole('region', { name: 'Notifications' })).toContainText('Run a simulation to export a video.');
  await expect(dialog.getByRole('spinbutton', { name: 'Start', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();
  await dialog.getByRole('tab', { name: 'Image' }).click();
  await expect(dialog.getByRole('img', { name: 'The picture as it will be saved' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Enlarge preview' }).click();
  await expect(page.getByRole('dialog', { name: 'Export preview', exact: true }).getByRole('img')).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(dialog.getByRole('button', { name: 'Enlarge preview' })).toBeFocused();
  await dialog.getByLabel('Size', { exact: true }).selectOption({ label: '1920 × 1080' });
  await expect(dialog.locator('.summary')).toHaveText('1920 × 1080 px');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe(`${fixture.header.case_name} network.png`);
  const png = await readFile((await file.path())!);
  expect([png.toString('latin1', 1, 4), png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(['PNG', 1920, 1080]);
  await expect(dialog).toBeHidden();
  // The right-click menu opens it too, with the size chosen kept.
  const network = page.getByLabel('Network view'), box = (await network.boundingBox())!;
  await network.click({ button: 'right', position: { x: box.width - 4, y: box.height - 4 } });
  await page.getByRole('menuitem', { name: 'Export…', exact: true }).click();
  await expect(dialog.getByLabel('Size', { exact: true })).toHaveValue('slide');
  expect(failures).toEqual([]);
});

test('preferences draft, apply, reset, and persist', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await openCase(page);
  const open = page.getByRole('button', { name: 'Settings', exact: true });
  await open.click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await preferenceSection(page, 'Network mappings');
  await page.getByRole('radio', { name: 'Browser defaults', exact: true }).check();
  await mapField(page, 'Color');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await open.click();
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('system');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await preferenceSection(page, 'Network mappings');
  await page.getByRole('radio', { name: 'Browser defaults', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Color mapping', exact: true })).toContainText('Default');
  await mapField(page, 'Color');
  await mapField(page, 'Label', '^Name');
  await expect(page.getByRole('button', { name: 'Label mapping', exact: true })).toContainText('Name');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await open.click();
  await preferenceSection(page, 'Network mappings');
  await page.getByRole('radio', { name: 'Browser defaults', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Label mapping', exact: true })).toContainText('Name');
  await expect(page.getByRole('spinbutton', { name: 'Label limit', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openCase(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Theme', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(failures).toEqual([]);
});

test('rendering failure leaves table and files usable', async ({ page }) => {
  // No WebGL2, as with hardware acceleration off or a blocked GPU.
  await page.addInitScript(() => {
    type Canvas = { prototype: { getContext(id: string, ...options: unknown[]): unknown } };
    const canvases: Canvas[] = typeof OffscreenCanvas === 'function' ? [HTMLCanvasElement, OffscreenCanvas] : [HTMLCanvasElement];
    for (const { prototype } of canvases) {
      const getContext = prototype.getContext;
      prototype.getContext = function (id, ...options) { return id === 'webgl2' ? null : getContext.call(this, id, ...options); };
    }
  });
  await page.reload();
  await openCase(page);
  await navigate(page, 'Network');
  await expect(page.getByRole('alert')).toContainText('Rendering is unavailable. This browser has no WebGL2.');
  await navigate(page, 'Table');
  await expect(page.getByRole('grid', { name: 'Bus' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await fileAction(page, 'Download case');
  expect(await (await downloading).failure()).toBeNull();
});

test('a stalled graphics download reports a failure and can be retried', async ({ page }) => {
  // Shorten the runtime's normal 30-second wait without changing production behavior.
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = milliseconds => timeout(Math.min(milliseconds, 1500));
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*.wasm', async route => { await held; await route.continue().catch(() => {}); });
  try {
    await page.reload();
    await page.locator('input[type=file]').setInputFiles({ name: 'example.case.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture)) });
    await expect(page.getByRole('progressbar', { name: 'Loading network' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Table', exact: true })).toHaveCount(0);
    const header = page.getByRole('banner'), bounds = await header.boundingBox();
    await expect(page.getByRole('alert')).toContainText('Rendering is unavailable.');
    expect(await header.boundingBox()).toEqual(bounds);
    await page.getByRole('button', { name: 'Try rendering again', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Loading network' })).toBeVisible();
    await navigate(page, 'Table');
    await expect(page.getByRole('grid', { name: 'Bus', exact: true })).toBeVisible();
  } finally { release(); }
});

test('a phone-width layout keeps every control in view without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible();
  await openCase(page);
  await expect(page.locator('.app-header')).not.toContainText(fixture.header.case_name);
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Export', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'GridKit menu', exact: true })).toBeInViewport();
  await expect(page.locator('.app-header').getByRole('button', { name: 'Download case', exact: true })).toHaveCount(0);
  expect(await page.locator('.app-header').evaluate(header => header.lastElementChild?.classList.contains('header-table'))).toBe(true);
  await showCaseInfo(page);
  await expect(page.getByRole('button', { name: 'Download case', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Discard case', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Power base (VA)')).toBeInViewport();
  expect(await page.locator('.property-list:visible').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await navigate(page, 'Buses');
  await expect(page.getByRole('gridcell', { name: 'North', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  await expect(page.getByRole('dialog', { name: 'Bus 1' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
});

test('context menus select what they open over and run its commands', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'An iPad has no right-click.');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await openCase(page);
  const menu = page.getByRole('menu'), labels = menu.locator('[role="menuitem"] > span');
  // A row's menu selects the row; Escape closes it and gives focus back.
  const grid = page.getByRole('grid', { name: 'Bus', exact: true }), north = grid.getByRole('gridcell', { name: 'North', exact: true });
  await north.click({ button: 'right' });
  await expect(menu).toHaveAccessibleName('Bus 1');
  await expect(labels).toHaveText(['Properties', 'Simulate fault', 'More…', 'Show in Network']);
  await expect(menu.getByRole('menuitem', { name: 'Properties', exact: true })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Show in Network', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  // The table exposes branch properties and returns focus to its grid.
  await selectClass(page, JSON.stringify(['devices', 'Branch']));
  const branchGrid = page.getByRole('grid', { name: 'Branch', exact: true });
  const line = branchGrid.getByRole('gridcell', { name: 'line-1', exact: true });
  await line.click({ button: 'right' });
  await expect(menu).toHaveAccessibleName('Branch line-1');
  await menu.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Branch line-1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close element', exact: true }).click();
  await expect(branchGrid).toBeFocused();
  // The case opened on the network, which was left before it settled; shown at last, it frames its rows, so a point
  // along the branch, off its middle, is on it. The network edits nothing, so its menus offer no Delete.
  await page.emulateMedia({ colorScheme: 'light' });
  await navigate(page, 'Network');
  const network = page.getByLabel('Network view');
  await expect(network).toHaveAttribute('data-ready', 'true');
  const box = (await network.boundingBox())!;
  await expect(async () => {
    await network.click({ button: 'right', position: { x: box.width / 2 + 63, y: box.height / 2 - 77 } });
    await expect(menu).toHaveAccessibleName('Branch line-1', { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await expect(labels).toHaveText(['Properties', 'Simulate line opening', 'More…', 'Show in Table']);
  await page.keyboard.press('Escape');
  // Empty space offers the view's own commands, kept on screen by a corner.
  await network.click({ button: 'right', position: { x: box.width - 4, y: box.height - 4 } });
  await expect(menu).toHaveAccessibleName('Network');
  await expect(labels).toHaveText(['Fit view', 'Export…']);
  const placed = (await menu.boundingBox())!;
  expect(placed.x + placed.width).toBeLessThanOrEqual(1280 - 8);
  expect(placed.y + placed.height).toBeLessThanOrEqual(844 - 8);
  await menu.getByRole('menuitem', { name: 'Fit view', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(network).toBeFocused();
  expect(failures).toEqual([]);
});

test('returning home clears the session immediately without a confirmation', async ({ page }) => {
  const prompts: string[] = [];
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
  await openCase(page);
  await navigate(page, 'Solver');
  await page.getByLabel('Duration', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'GridKit menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Return home', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file…' })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
});

test('Network mappings and interaction preferences apply and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCase(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const category = (name: string) => dialog.getByRole('navigation').getByRole('button', { name, exact: true });
  await category('Network mappings').click();
  await page.getByRole('radio', { name: 'Browser defaults', exact: true }).check();
  await page.getByRole('group', { name: 'Shape', exact: true }).getByRole('button', { name: 'Diamond', exact: true }).click();
  await mapField(page, 'Color');
  await mapField(page, 'Radius', 'Voltage, real');
  await page.getByRole('button', { name: 'Radius mapping', exact: true }).click();
  await page.getByLabel('Radius minimum', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await category('Appearance').click();
  await category('Network mappings').click();
  await page.getByRole('radio', { name: 'Browser defaults', exact: true }).check();
  await page.getByRole('button', { name: 'Radius mapping', exact: true }).click();
  await expect(page.getByLabel('Radius minimum', { exact: true })).toHaveValue('');
  await page.getByLabel('Radius minimum', { exact: true }).fill('3');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('.property-list:visible').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await category('Interaction').click();
  await expect(page.getByLabel('Interaction scope')).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Interaction Navigation Picking tolerance' }).fill('14');
  await page.getByRole('spinbutton', { name: 'Interaction Navigation Picking tolerance' }).press('Tab');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await openMappings(page);
  await expect(page.getByRole('button', { name: 'Radius mapping', exact: true })).toContainText('Default');
  const shape = page.getByRole('region', { name: 'Network mappings', exact: true }).getByRole('group', { name: 'Shape', exact: true });
  await expect(shape.getByRole('button', { name: 'Diamond', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Reset Buses mappings', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await openCase(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await category('Interaction').click();
  await expect(page.getByLabel('Interaction scope')).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Interaction Navigation Picking tolerance' })).toHaveValue('14');
  await page.getByRole('button', { name: 'Reset Interaction section' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Interaction Navigation Picking tolerance' })).toHaveValue('6');
  expect(errors).toEqual([]);
});

test('10k bus tables keep DOM bounded and properties read-only', async ({ page }) => {
  await openCase(page, { ...fixture, buses: Array.from({ length: 10_000 }, (_, i) => ({ ...fixture.buses[0]!, number: i + 1, name: 'Bus ' + (i + 1) })) });
  const grid = page.getByRole('grid', { name: 'Bus', exact: true });
  await grid.getByRole('gridcell', { name: 'Bus 1', exact: true }).click();
  await grid.press('End');
  await expect(grid.getByRole('gridcell', { name: 'Bus 10000', exact: true })).toBeInViewport();
  expect(await grid.getByRole('row').count()).toBeLessThan(70);
  await grid.press('Enter');
  await expect(page.getByLabel('Element name')).toHaveValue('Bus 10000');
  await expect(page.getByLabel('Element name')).toHaveAttribute('readonly', '');
});

async function openMappings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await preferenceSection(page, 'Network mappings');
}
async function mapField(page: Page, label: string, name = 'Nominal voltage') {
  await page.getByRole('button', { name: `${label} mapping`, exact: true }).click();
  await page.getByRole('dialog', { name: `${label} mapping`, exact: true }).getByRole('button', { name: new RegExp(`^(?:${name})`) }).click();
  // Choosing a field leaves the popover open on what shows of it.
  await page.keyboard.press('Escape');
}

test('case issues open read-only properties and preserve unfinished downloads', async ({ page }) => {
  const incomplete = { ...fixture, devices: [{ ...fixture.devices[0]!, ports: { bus1: 1 } }] };
  await openCase(page, incomplete);
  await showCaseInfo(page);
  await page.getByRole('button', { name: 'Download case', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Needs attention', exact: true })).toContainText('Correct these issues in the source case before simulation.');
  await page.getByRole('button', { name: 'View Branch line-1', exact: true }).click();
  await expect(page.getByLabel('To bus', { exact: true })).toHaveValue('Not connected');
  await expect(page.getByLabel('To bus', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Close element', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await fileAction(page, 'Download case');
  const saved = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(nativeCase(saved)).toEqual(incomplete);
});

test('a case opened while latkit still loads draws once it has', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*.wasm', async route => { await held; await route.continue(); });
  await page.reload();
  // Errors on the reloaded page only: WebKit reports the first page's requests that the reload cancels as access control failures.
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openEmptyCase(page);
  await navigate(page, 'Network');
  release();
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true');
  expect(failures).toEqual([]);
});


test('view mappings apply, cancel and reset without changing the case', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCase(page);
  async function downloadedCase() {
    const downloading = page.waitForEvent('download');
    await fileAction(page, 'Download case');
    return JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  }
  const before = await downloadedCase();
  await openMappings(page);
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const view = settings.getByRole('radio', { name: 'This view', exact: true });
  const browser = settings.getByRole('radio', { name: 'Browser defaults', exact: true });
  const shape = settings.getByRole('group', { name: 'Shape', exact: true });
  await expect(view).toBeChecked();
  await expect(settings).not.toContainText('read-only');
  await expect(settings.getByRole('button', { name: 'Color mapping', exact: true })).toBeEnabled();
  await shape.getByRole('button', { name: 'Diamond', exact: true }).click();
  await mapField(page, 'Radius', 'Voltage, real');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await openMappings(page);
  await expect(shape.getByRole('button', { name: 'Diamond', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Radius mapping', exact: true })).not.toContainText('Default');
  await shape.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openMappings(page);
  await expect(shape.getByRole('button', { name: 'Diamond', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await browser.check();
  await shape.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await openMappings(page);
  await expect(view).toBeChecked();
  await expect(shape.getByRole('button', { name: 'Diamond', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await downloadedCase()).toEqual(before);
  await openMappings(page);
  await settings.getByRole('button', { name: 'Reset Buses mappings', exact: true }).click();
  await expect(shape.getByRole('button', { name: 'Rectangle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await openMappings(page);
  await expect(settings.getByRole('button', { name: 'Reset Buses mappings', exact: true })).toBeDisabled();
  await shape.getByRole('button', { name: 'Diamond', exact: true }).click();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await openCase(page);
  await openMappings(page);
  await expect(shape.getByRole('button', { name: 'Rectangle', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
