import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };
import emptyFixture from './fixtures/empty.case.json' with { type: 'json' };
import { defaults, geographyOf } from '../src/preferences/definitions.js';

// Compare the native case separately from the editor's persisted identity/layout metadata.
function nativeCase(value: typeof fixture) {
  const native = (row: Record<string, unknown>) => {
    const { $editor: _metadata, ...fields } = row;
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
  await expect(page.locator('.case-name')).toHaveText(value.header.case_name);
  await navigate(page, 'Table');
}

async function showCaseInfo(page: Page) {
  if (!await page.getByRole('dialog', { name: 'Case information', exact: true }).isVisible()) {
    // The case's name opens its information.
    await page.getByRole('button', { name: /^Case information:/ }).click();
  }
}

async function selectClass(page: Page, key: string, label = 'Table class') {
  await page.getByRole('button', { name: label, exact: true }).click();
  const name = key ? JSON.parse(key)[1] as string : 'All classes';
  await page.getByRole('dialog', { name: label, exact: true }).getByRole('button', { name, exact: true }).click();
}

async function preferenceSection(page: Page, label: string) {
  const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
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
  if (await page.locator('.case-name').isVisible()) {
    const close = page.getByRole('button', { name: 'Close case information', exact: true });
    if (await close.isVisible()) await close.click();
    await page.getByRole('button', { name: 'GridKit home', exact: true }).click();
    await page.getByRole('button', { name: 'Return home', exact: true }).click();
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

test('empty case files use Table and models connect only through their properties', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openCase(page, emptyFixture);
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Diagram', exact: true })).toHaveCount(0);
  const add = page.getByRole('button', { name: 'Add model', exact: true });
  const remove = page.getByRole('button', { name: 'Delete selected element', exact: true });
  await add.click();
  const picker = page.getByRole('dialog', { name: 'Add model', exact: true });
  await expect(picker.getByRole('button', { name: 'Infinite bus', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Bus', exact: true }).press('ArrowRight');
  await expect(picker.getByRole('button', { name: 'Infinite bus', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Bus', exact: true }).click();
  const bus = page.getByRole('dialog', { name: 'Bus 1', exact: true });
  const name = bus.getByLabel('Element name');
  await name.fill('North');
  await name.press('End');
  await name.press('Backspace');
  await expect(name).toHaveValue('Nort');
  await name.fill('North');
  await bus.getByRole('button', { name: 'Apply', exact: true }).click();
  const north = page.getByRole('gridcell', { name: 'North', exact: true });
  await expect(north).toBeVisible();
  await add.click();
  await picker.getByRole('searchbox').fill('LoadZIP');
  await picker.getByRole('button', { name: 'LoadZIP', exact: true }).click();
  const load = page.getByRole('dialog', { name: 'LoadZIP loadzip-1', exact: true });
  await expect(load.getByRole('combobox', { name: 'bus', exact: true })).toContainText('Choose');
  await load.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(remove).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('gridcell', { name: 'loadzip-1', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('gridcell', { name: 'loadzip-1', exact: true })).toBeVisible();
  await north.click();
  await page.keyboard.press('Escape');
  await expect(remove).toBeDisabled();
  await north.click();
  await page.keyboard.press('Backspace');
  await expect(north).toHaveCount(0);
  await expect(page.getByRole('gridcell', { name: 'loadzip-1', exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  await north.click();
  await navigate(page, 'Network');
  const network = page.getByLabel('Network view');
  await expect(network).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Case mappings', exact: true })).toHaveCount(0);
  await expect(remove).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeHidden();
  await openMappings(page);
  await expect(page.getByRole('region', { name: 'Network mappings', exact: true })).toBeVisible();
  await expect(page.getByLabel('Mapping view')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preferences', exact: true })).toBeFocused();
  await network.press('Delete');
  await navigate(page, 'Table');
  await expect(north).toBeVisible();
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
});

test('round trip with history', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openCase(page);
  await showCaseInfo(page);
  await page.getByLabel('Name', { exact: true }).fill('Edited case');
  await page.getByLabel('Frequency base (Hz)').fill('50');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.keyboard.press('Control+z');
  await showCaseInfo(page);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(fixture.header.case_name);
  await expect(page.getByLabel('Frequency base (Hz)')).toHaveValue('60');
  await page.getByRole('button', { name: 'Close case information' }).click();
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');

  const downloading = page.waitForEvent('download');
  await fileAction(page, 'Download case');
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe('Edited case.case.json');
  const value = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  const stableId = value.buses[0].$editor.id;
  expect(nativeCase(value)).toEqual({
    ...fixture,
    header: { ...fixture.header, case_name: 'Edited case' },
    params: { ...fixture.params, freq_base: 50 },
  });
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  await openEmptyCase(page);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Untitled');
  await openCase(page, value);
  await expect(page.locator(`[data-key="${stableId}"]`)).toContainText('North');
  expect(failures).toEqual([]);
});

test('search, table selection, and element editing', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openCase(page);
  const search = page.getByRole('searchbox', { name: 'Search elements' });
  await search.fill('North');
  await search.press('ArrowDown');
  await page.getByRole('grid', { name: 'All classes' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Element name')).toHaveValue('North');
  await page.getByLabel('Element name').fill('North station');
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await fileAction(page, 'Download case');
  const saved = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(saved.buses[0].name).toBe('North station');
  await expect(page.getByRole('grid', { name: 'All classes' }).getByRole('gridcell', { name: 'North station', exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('grid', { name: 'All classes' }).getByRole('gridcell', { name: 'North', exact: true })).toBeVisible();
  await search.fill('future-1');
  await page.getByRole('grid', { name: 'All classes' }).getByRole('gridcell', { name: 'future-1', exact: true }).dblclick();
  await expect(page.getByRole('dialog', { name: 'FutureDevice future-1' })).toBeVisible();
  await page.getByRole('button', { name: 'Close element' }).click();
  await search.focus();
  await search.press('Escape');
  await expect(page.getByRole('grid', { name: 'Search results' })).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('renderer selection and view switching', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openCase(page);
  await navigate(page, 'Network');
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true');
  // A pixel-clamped unit radius must not inflate the first geographic fit to several degrees.
  const pixels = await page.getByLabel('Network view').screenshot();
  const span = await page.evaluate(async encoded => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close();
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let first = canvas.height, last = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4, r = rgba[offset]!, g = rgba[offset + 1]!, b = rgba[offset + 2]!;
      if (g > r * 1.2 && b > r * 1.2 && Math.abs(g - b) < 30) { first = Math.min(first, y); last = Math.max(last, y); }
    }
    return (last - first) / canvas.height;
  }, pixels.toString('base64'));
  expect(span).toBeGreaterThan(0.4);
  await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Globe', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search elements' }).fill('North');
  await page.getByRole('grid', { name: 'Search results' }).getByRole('gridcell', { name: 'North' }).click();
  await expect(page.getByLabel('Element name')).toHaveValue('North');
  await page.getByRole('button', { name: 'Close element' }).click();
  await expect(page.getByRole('button', { name: 'Network', exact: true })).toHaveAttribute('aria-current', 'page');
  await navigate(page, 'Table');
  await expect(page.getByRole('row', { selected: true })).toContainText('North');
  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  await page.getByLabel('Element name').fill('North station');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('row', { selected: true })).toContainText('North station');
  await navigate(page, 'Network');
  await page.getByRole('button', { name: 'Fit view' }).click();
  await openCase(page, { ...fixture, buses: fixture.buses.map(bus => ({
    ...bus, extension: { ...bus.extension, latitude: 200 },
  })) });
  await navigate(page, 'Network');
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: 'Globe', exact: true })).toBeDisabled();
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
  await expect(dialog.getByRole('tabpanel')).toHaveText('Run a simulation to export a video.');
  await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();
  await dialog.getByRole('tab', { name: 'Image' }).click();
  await expect(dialog.getByRole('img', { name: 'The picture as it will be saved' })).toBeVisible();
  await dialog.getByLabel('Size', { exact: true }).selectOption({ label: '1920 × 1080' });
  await expect(dialog.getByRole('definition')).toHaveText('1920 × 1080');
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
  const open = page.getByRole('button', { name: 'Preferences', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
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
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Theme', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(failures).toEqual([]);
});

test('rendering failure leaves table and files usable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.reload();
  await openCase(page);
  await navigate(page, 'Network');
  await expect(page.getByRole('alert')).toContainText('Rendering is unavailable.');
  await page.getByRole('button', { name: 'Open Table' }).click();
  await expect(page.getByRole('grid', { name: 'All classes' })).toBeVisible();
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
    await expect(page.getByRole('status').filter({ hasText: 'Drawing network' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Rendering is unavailable.');
    await page.getByRole('button', { name: 'Try rendering again', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Drawing network' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Table', exact: true }).click();
    await expect(page.getByRole('grid', { name: 'All classes', exact: true })).toBeVisible();
  } finally { release(); }
});

test('retry replaces a GPU whose shader compilation never finishes', async ({ page }) => {
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = milliseconds => timeout(Math.min(milliseconds, 3000));
    type Device = { createRenderPipelineAsync: () => Promise<unknown>; createComputePipelineAsync: () => Promise<unknown> };
    const adapter = (globalThis as unknown as { GPUAdapter: { prototype: { requestDevice(...args: unknown[]): Promise<Device> } } }).GPUAdapter.prototype;
    const request = adapter.requestDevice;
    let devices = 0;
    adapter.requestDevice = async function (...args: unknown[]) {
      const device = await request.apply(this, args);
      if (++devices === 1) {
        // A compiler stuck on this device also stalls every subsequent view using it.
        device.createRenderPipelineAsync = () => new Promise(() => {});
        device.createComputePipelineAsync = () => new Promise(() => {});
      }
      return device;
    };
  });
  await page.reload();
  await page.locator('input[type=file]').setInputFiles({ name: 'example.case.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('alert')).toContainText('Rendering is unavailable.');
  await page.getByRole('button', { name: 'Try rendering again', exact: true }).click();
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true', { timeout: 10000 });
  // Read actual drawn pixels, not just the application's readiness flag.
  for (let visit = 0; visit < 2; visit++) {
    await navigate(page, 'Table');
    await navigate(page, 'Network');
    await expect.poll(async () => {
      // WebGPU discards its drawing buffer after presentation. Inspect the composited screenshot.
      const png = await page.getByLabel('Network view').screenshot();
      return page.evaluate(async base64 => {
        const source = new Image();
        source.src = `data:image/png;base64,${base64}`;
        await source.decode();
        const sample = document.createElement('canvas');
        sample.width = sample.height = 128;
        const context = sample.getContext('2d')!;
        context.drawImage(source, 0, 0, 128, 128);
        const pixels = context.getImageData(0, 0, 128, 128).data, colors = new Set<string>();
        for (let at = 0; at < pixels.length; at += 4)
          if (pixels[at + 3]) colors.add(`${pixels[at]},${pixels[at + 1]},${pixels[at + 2]}`);
        return colors.size;
      }, png.toString('base64'));
    }).toBeGreaterThan(8);
  }
});

test('a phone-width layout keeps every control in view without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible();
  await openCase(page);
  await expect(page.getByRole('button', { name: /^Case information:/ })).toBeInViewport();
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Export', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'GridKit home', exact: true })).toBeInViewport();
  await expect(page.locator('.app-header').getByRole('button', { name: 'Download case', exact: true })).toHaveCount(0);
  expect(await page.locator('.app-header').evaluate(header => header.lastElementChild?.classList.contains('header-search'))).toBe(true);
  await showCaseInfo(page);
  await expect(page.getByRole('button', { name: 'Download case', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Discard case', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Power base (VA)')).toBeInViewport();
  expect(await page.locator('.property-list:visible').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await navigate(page, 'Buses');
  await expect(page.getByRole('gridcell', { name: 'North', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  await expect(page.getByRole('dialog', { name: 'Bus 1' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Apply' })).toBeInViewport();
});

test('context menus select what they open over and run its commands', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await openCase(page);
  const menu = page.getByRole('menu'), labels = menu.locator('[role="menuitem"] > span');
  // A row's menu selects the row; Escape closes it and gives focus back.
  const grid = page.getByRole('grid', { name: 'All classes' }), north = grid.getByRole('gridcell', { name: 'North', exact: true });
  await north.click({ button: 'right' });
  await expect(menu).toHaveAccessibleName('Bus 1');
  await expect(labels).toHaveText(['Properties', 'Simulate fault', 'More…', 'Show in Network', 'Delete']);
  await expect(menu.getByRole('menuitem', { name: 'Properties', exact: true })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Delete Backspace');
  await expect(grid.getByRole('row', { selected: true })).toContainText('North');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(grid).toBeFocused();
  // The menu key opens the active row's; arrows wrap, and a choice runs its command.
  await grid.press('Shift+F10');
  await expect(menu).toHaveAccessibleName('Bus 1');
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Delete Bus 1?', exact: true }).getByRole('button', { name: 'Keep element', exact: true }).click();
  await expect(grid).toBeFocused();
  // The table exposes branch properties and returns focus to its grid.
  const line = grid.getByRole('gridcell', { name: 'line-1', exact: true });
  await line.click({ button: 'right' });
  await expect(menu).toHaveAccessibleName('Branch line-1');
  await menu.getByRole('menuitem', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Branch line-1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close element', exact: true }).click();
  await expect(grid).toBeFocused();
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

test('GridKit confirms returning home and clears the session', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await openCase(page);
  const home = page.getByRole('button', { name: 'GridKit home', exact: true });
  const confirmation = page.getByRole('dialog', { name: 'Return home?', exact: true });
  await home.click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(confirmation).not.toContainText("haven't downloaded");
  await page.keyboard.press('Escape');
  await expect(home).toBeFocused();
  await expect(page.locator('.case-name')).toHaveText(fixture.header.case_name);
  await showCaseInfo(page);
  await page.getByLabel('Name', { exact: true }).fill('Changed case');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await home.focus();
  await home.press('Enter');
  await expect(confirmation).toContainText("Changes you haven't downloaded will be lost.");
  expect((await confirmation.boundingBox())!.height).toBeLessThan(300);
  await expect(confirmation).toContainText("Changed case. Changes");
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(home).toBeFocused();
  await expect(page.locator('.case-name')).toHaveText('Changed case');
  await home.press('Enter');
  await confirmation.getByRole('button', { name: 'Return home', exact: true }).press('Enter');
  await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open file…' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Case information' })).toHaveCount(0);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await openEmptyCase(page);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Untitled');
  await page.getByRole('button', { name: 'Close case information' }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toHaveCount(0);
});

test('Network mappings and interaction preferences apply and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCase(page);
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
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
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await category('Interaction').click();
  await expect(page.getByLabel('Interaction scope')).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Interaction Navigation Picking tolerance' })).toHaveValue('14');
  await page.getByRole('button', { name: 'Reset Interaction section' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Interaction Navigation Picking tolerance' })).toHaveValue('6');
  expect(errors).toEqual([]);
});

test('10k bus tables and connection pickers keep DOM bounded and preserve drafts', async ({ page }) => {
  await openCase(page, {
    ...fixture,
    buses: Array.from({ length: 10_000 }, (_, i) => ({ ...fixture.buses[0]!, number: i + 1, name: 'Bus ' + (i + 1) })),
  });
  const grid = page.getByRole('grid', { name: 'All classes', exact: true });
  await grid.getByRole('gridcell', { name: 'Bus 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close element' })).toHaveCount(0);
  await expect(grid.getByRole('row', { selected: true })).toContainText('Bus 1');
  await grid.press('End');
  await expect(grid.getByRole('gridcell', { name: 'control', exact: true })).toBeInViewport();
  expect(await grid.getByRole('row').count()).toBeLessThan(70);
  await selectClass(page, JSON.stringify(['devices', 'Branch']));
  await page.getByRole('gridcell', { name: 'line-1', exact: true }).dblclick();
  const dialog = page.getByRole('dialog', { name: 'Branch line-1', exact: true });
  const connection = dialog.getByRole('combobox', { name: 'From bus', exact: true });
  await connection.click();
  const popup = page.getByRole('dialog', { name: 'From bus', exact: true });
  const buses = popup.getByRole('grid', { name: 'Buses', exact: true });
  expect(await buses.getByRole('row').count()).toBeLessThan(30);
  expect(await popup.locator('option').count()).toBe(0);
  await popup.getByRole('searchbox', { name: 'Find buses' }).fill('Bus 10000');
  await popup.getByRole('searchbox').press('ArrowDown');
  await buses.press('Enter');
  await expect(popup).not.toBeVisible();
  await expect(connection).toContainText('10000');
  await expect(connection).toBeFocused();
  await connection.click();
  await popup.getByRole('searchbox').press('Escape');
  await expect(dialog).toBeVisible();
  await expect(connection).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('gridcell', { name: 'line-1', exact: true }).dblclick();
  await expect(connection).toContainText('1 — Bus 1');
});

test('authors a connected case with shared forms, reversible deletion, and stable saved identities', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openEmptyCase(page);
  await page.getByRole('button', { name: 'Close case information' }).click();
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-current', 'page');
  const add = async (model: string, dialog: string) => {
    await page.getByRole('button', { name: 'Add model', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add model', exact: true });
    await picker.getByRole('searchbox').fill(model);
    await picker.getByRole('button', { name: model, exact: true }).click();
    await page.getByRole('dialog', { name: dialog, exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  };
  // Both branch connections are chosen explicitly in the shared properties form.
  await add('Bus', 'Bus 1');
  await add('Branch', 'Branch branch-1');
  await add('Bus', 'Bus 2');
  await navigate(page, 'Table');
  for (const [number, name] of [['1', 'North'], ['2', 'South']] as const) {
    await page.getByRole('gridcell', { name: number, exact: true }).dblclick();
    const dialog = page.getByRole('dialog', { name: `Bus ${number}`, exact: true });
    await dialog.getByLabel('Element name').fill(name);
    await dialog.getByLabel('Parameters Nominal voltage').fill('230');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  }
  await page.getByRole('gridcell', { name: 'branch-1', exact: true }).dblclick();
  const branch = page.getByRole('dialog', { name: 'Branch branch-1', exact: true });
  await branch.getByRole('combobox', { name: 'From bus', exact: true }).click();
  await page.getByRole('grid', { name: 'Buses', exact: true }).getByRole('gridcell', { name: '1', exact: true }).click();
  await branch.getByRole('combobox', { name: 'To bus', exact: true }).click();
  await page.getByRole('grid', { name: 'Buses', exact: true }).getByRole('gridcell', { name: '2', exact: true }).click();
  await branch.getByLabel('Parameters Resistance', { exact: true }).fill('0');
  await branch.getByLabel('Parameters Reactance', { exact: true }).fill('0');
  await branch.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(branch.getByLabel('Parameters Reactance', { exact: true })).toBeFocused();
  await branch.getByLabel('Parameters Reactance', { exact: true }).fill('0.1');
  await branch.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(branch).toHaveCount(0);
  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  const bus = page.getByRole('dialog', { name: 'Bus 1', exact: true });
  await bus.getByLabel('Number', { exact: true }).fill('2');
  await bus.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(bus.getByLabel('Number', { exact: true })).toBeFocused();
  await bus.getByLabel('Number', { exact: true }).fill('40');
  await bus.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('gridcell', { name: 'North', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Delete Bus 40?', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Delete Bus 40?', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete selected element', exact: true })).toBeEnabled();
  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Delete element', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete Bus 40?', exact: true });
  await expect(confirm).toContainText('1 connected element');
  await expect(confirm).toContainText('Branch branch-1');
  await expect(confirm.getByRole('button', { name: 'Keep element' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Keep element' }).click();
  await expect(page.getByRole('button', { name: 'Delete element', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Delete element', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete 2 elements', exact: true }).click();
  await expect(page.getByRole('gridcell', { name: 'North', exact: true })).toHaveCount(0);
  await expect(page.getByRole('gridcell', { name: 'branch-1', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('gridcell', { name: 'North', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await fileAction(page, 'Download case');
  const saved = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(saved.devices[0].ports).toEqual({ bus1: 40, bus2: 2 });
  expect(saved.devices[0].params).toMatchObject({ R: 0, X: 0.1, tap: 1, phase: 0 });
  expect(saved.buses[0].init).toEqual({ Vr: 1, Vi: 0 });
  await openCase(page, saved);
  await expect(page.locator(`[data-key="${saved.devices[0].$editor.id}"]`)).toContainText('branch-1');
  expect(failures).toEqual([]);
});

test('a machine and its controls authored in Table download as a case native GridKit simulates', async ({ page }) => {
  // GridKit simulates natively wherever its runtime image is on this machine, as building the stack leaves it.
  const image = process.env.GRIDKIT_RUNTIME_IMAGE ?? '';
  test.skip(spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0, `Simulating natively needs ${image}; docker compose up --build pulls it.`);
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openCase(page, emptyFixture);
  // Models use the same property and connection controls as existing elements.
  const add = async (label: string, finish?: (dialog: Locator) => Promise<void>) => {
    await page.getByRole('button', { name: 'Add model', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add model', exact: true });
    await picker.getByRole('searchbox').fill(label);
    await picker.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close element', exact: true }) });
    await finish?.(dialog);
    await dialog.getByRole('button', { name: finish ? 'Apply' : 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  const connect = async (dialog: Locator, port: string, target: string) => {
    await dialog.getByRole('combobox', { name: port, exact: true }).click();
    await page.getByRole('grid', { name: 'Signals and ports', exact: true }).getByRole('gridcell', { name: target, exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: port, exact: true })).toContainText(target);
  };
  await add('Infinite bus', dialog => dialog.getByLabel('Element name').fill('Grid'));
  await add('Bus', dialog => dialog.getByLabel('Element name').fill('Plant'));
  const busConnection = async (dialog: Locator, port = 'bus') => {
    await dialog.getByRole('combobox', { name: port, exact: true }).click();
    await page.getByRole('grid', { name: 'Buses', exact: true }).getByRole('gridcell', { name: '2', exact: true }).click();
  };
  await add('Branch', async dialog => {
    await busConnection(dialog, 'From bus');
    await dialog.getByRole('combobox', { name: 'To bus', exact: true }).click();
    await page.getByRole('grid', { name: 'Buses', exact: true }).getByRole('gridcell', { name: '1', exact: true }).click();
  });
  await add('GENROU', dialog => busConnection(dialog));
  await add('IEEET1', async dialog => {
    await busConnection(dialog);
    await connect(dialog, 'efd', 'genrou-1 / efd');
    await connect(dialog, 'speed', 'genrou-1 / speed');
  });
  // A governor connects through the machine's signals, without a bus port.
  await add('TGOV1', async dialog => {
    await connect(dialog, 'pmech', 'genrou-1 / pmech');
    await connect(dialog, 'speed', 'genrou-1 / speed');
  });
  await add('LoadZ', async dialog => {
    await busConnection(dialog);
    await dialog.getByLabel('Parameters R', { exact: true }).fill('1');
    await dialog.getByLabel('Parameters X', { exact: true }).fill('0');
  });
  await expect(page.getByRole('button', { name: /Needs attention/ })).toHaveCount(0);
  await showCaseInfo(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download case', exact: true }).click();
  const download = await downloading;
  const directory = await mkdtemp(join(tmpdir(), 'gridkit-e2e-'));
  try {
    // The case is simulated exactly as downloaded; reserializing it would drop the real literals GridKit requires.
    await download.saveAs(join(directory, 'model.json'));
    const saved = JSON.parse(await readFile(join(directory, 'model.json'), 'utf8'));
    const device = (id: string) => saved.devices.find((row: { id: string }) => row.id === id).ports;
    expect(saved.devices.map((row: { class: string }) => row.class)).toEqual(['Branch', 'Genrou', 'Ieeet1', 'Tgov1', 'LoadZ']);
    expect(device('branch-1')).toEqual({ bus1: 2, bus2: 1 });
    expect(device('ieeet1-1')).toMatchObject({ bus: 2, efd: device('genrou-1').efd, speed: device('genrou-1').speed });
    expect(device('tgov1-1')).toEqual({ pmech: device('genrou-1').pmech, speed: device('genrou-1').speed });
    await writeFile(join(directory, 'study.json'), JSON.stringify({ system_model_file: 'model.json', tmax: 0.5, events: [] }));
    const result = spawnSync('docker', ['run', '--rm', '--pull=never', '--mount', `type=bind,source=${directory},target=/input,readonly`,
      '--workdir', '/tmp', '--entrypoint', 'DynamicSimulation', image, '/input/study.json'], { encoding: 'utf8', timeout: 30_000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('Complete in');
  } finally { await rm(directory, { recursive: true, force: true }); }
  expect(failures).toEqual([]);
});

async function openMappings(page: Page) {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await preferenceSection(page, 'Network mappings');
}
async function mapField(page: Page, label: string, name = 'Nominal voltage') {
  await page.getByRole('button', { name: `${label} mapping`, exact: true }).click();
  await page.getByRole('dialog', { name: `${label} mapping`, exact: true }).getByRole('button', { name: new RegExp(`^(?:${name})`) }).click();
  // Choosing a field leaves the popover open on what shows of it.
  await page.keyboard.press('Escape');
}

test('case issues guide live completion, branch repair and unfinished downloads', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCase(page, { ...fixture, devices: fixture.devices.slice(0, 1) });
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add model', exact: true });
  await picker.getByRole('searchbox').fill('LoadZ');
  await picker.getByRole('button', { name: 'LoadZ', exact: true }).click();
  await page.getByRole('dialog', { name: 'LoadZ loadz-1', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('button', { name: /Needs attention/ })).toHaveCount(0);
  await showCaseInfo(page);
  await page.getByRole('button', { name: 'Download case', exact: true }).click();
  await page.getByRole('button', { name: 'Edit LoadZ loadz-1', exact: true }).click();
  await page.getByLabel('Parameters R', { exact: true }).fill('1');
  await page.getByLabel('Parameters X', { exact: true }).fill('0');
  await page.getByRole('combobox', { name: 'bus', exact: true }).click();
  await page.getByRole('grid', { name: 'Buses', exact: true }).getByRole('gridcell', { name: '1', exact: true }).click();
  await expect(page.locator('.completion')).toHaveCount(0);
  await page.getByLabel('Parameters R', { exact: true }).fill('0');
  await expect(page.locator('.completion')).toContainText('Needs attention (2)');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByLabel('Parameters R', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Parameters R', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: /Needs attention/ })).toHaveCount(0);
  await navigate(page, 'Table');
  await page.getByRole('gridcell', { name: 'line-1', exact: true }).dblclick();
  await page.getByRole('combobox', { name: 'To bus', exact: true }).click();
  await page.getByRole('button', { name: 'Unconnected', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await navigate(page, 'Network');
  await showCaseInfo(page);
  await page.getByRole('button', { name: 'Download case', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Branch line-1', exact: true })).toContainText('Connect To bus.');
  await page.getByRole('button', { name: 'Edit Branch line-1', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'To bus', exact: true })).toContainText('Choose');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await showCaseInfo(page);
  await page.getByRole('button', { name: 'Download case', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Needs attention', exact: true })).toContainText('Resolve these issues before simulation.');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unfinished case', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(saved.devices[0].ports).toEqual({ bus1: 1 });
  expect(saved.devices[1].params).toEqual({ R: 1, X: 0 });
});

test('model picker creates unfinished devices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openEmptyCase(page);
  await navigate(page, 'Table');
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add model', exact: true });
  await expect(picker.getByRole('button').first()).toBeFocused();
  await picker.getByRole('button', { name: 'Exciter', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'ESDC1A', exact: true })).toBeFocused();
  await picker.getByRole('button', { name: 'IEEET1', exact: true }).click();
  const properties = page.getByRole('dialog', { name: 'Ieeet1 ieeet1-1', exact: true });
  await expect(properties.getByText('Needs attention (1)', { exact: true })).toBeVisible();
  await expect(properties.getByRole('combobox', { name: 'bus', exact: true })).toContainText('Choose');
  await expect(properties.getByLabel('Parameters Tr', { exact: true })).toHaveValue('0');
  await properties.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.view-message[role="alert"], .mapping-notice')).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await fileAction(page, 'Download case');
  const saved = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(saved.devices).toHaveLength(1);
  expect(saved.devices[0]).toMatchObject({ class: 'Ieeet1', ports: {}, params: { Tr: 0 } });
  expect(saved.devices[0].$editor.placement).toBeUndefined();
  await openCase(page, saved);
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  await picker.getByRole('searchbox').fill('sexs');
  await picker.getByRole('searchbox').press('ArrowDown');
  await picker.getByRole('button', { name: 'SEXS-PTI', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'SexsPti sexspti-1', exact: true })).toBeVisible();
  await expect(page.getByLabel('Parameters Ta', { exact: true })).toHaveValue('');
  expect(failures).toEqual([]);
});

test('a case opened while latkit still loads draws once it has', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*.wasm', async route => { await held; await route.continue(); });
  await page.reload();
  await openEmptyCase(page);
  await navigate(page, 'Network');
  release();
  await expect(page.getByLabel('Network view')).toHaveAttribute('data-ready', 'true');
  expect(failures).toEqual([]);
});
