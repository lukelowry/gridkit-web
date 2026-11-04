import { test, expect, type Page } from '@playwright/test';
import { completedRun } from './fixtures/completed-run.js';
import fixture from '../../library/test/small.case.json' with { type: 'json' };

async function openCase(page: Page) {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
}

test('a long solver failure stays reachable and can be retried in a short workspace', async ({ page }) => {
  const message = `خطأ — 接続できません ⚡ ${'long-unbroken-service-detail'.repeat(80)}`;
  let submitted = 0;
  await page.route('**/api/solver/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/runs')) {
      submitted++;
      return route.fulfill({ status: 503, json: { code: 'unavailable', message } });
    }
    return route.fulfill({ status: 204 });
  });
  await page.setViewportSize({ width: 320, height: 360 });
  await openCase(page);
  await run(page);
  const notice = page.getByRole('region', { name: 'Notifications' });
  await expect(notice.getByRole('alert')).toContainText(message);
  const bounds = await notice.evaluate(element => {
    const rect = element.getBoundingClientRect(), workspace = element.parentElement!.getBoundingClientRect();
    return { inside: rect.top >= workspace.top && rect.bottom <= workspace.bottom,
      fits: element.scrollWidth <= element.clientWidth, scrolls: element.scrollHeight > element.clientHeight };
  });
  expect(bounds).toEqual({ inside: true, fits: true, scrolls: true });
  await expect(notice.getByRole('button', { name: 'Dismiss', exact: true })).toBeInViewport();
  const retry = notice.getByRole('button', { name: 'Run again', exact: true });
  await retry.focus();
  await expect(retry).toBeInViewport();
  await retry.press('Enter');
  await expect.poll(() => submitted).toBe(2);
  await expect(notice.getByRole('alert')).toContainText(message);
  await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(notice.getByRole('alert')).toHaveCount(0);
});

test('plot retry preserves results and the timeline has forced-colors keyboard focus', async ({ page }) => {
  const submitted = await completedRun(page);
  // Fail plot canvases until the device is restored. Network rendering remains available.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (!document.documentElement.hasAttribute('data-test-plot-recovered') && args[0] === 'webgpu' && this.getAttribute('aria-label')?.includes('plot')) {
        throw new Error(`Plot device unavailable: ${'long-device-detail'.repeat(50)}`);
      }
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await openCase(page);
  await run(page);
  const results = page.getByRole('region', { name: 'Simulation', exact: true });
  await expect(results.getByRole('alert')).toContainText('The plot could not be drawn.');
  expect(await results.getByRole('alert').evaluate(element => !!element.closest('[aria-busy="true"]'))).toBe(false);
  const canvas = results.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  await results.getByText('Details', { exact: true }).click();
  expect(await results.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('data-test-plot-recovered', ''));
  await results.getByRole('button', { name: 'Retry plot', exact: true }).press('Enter');
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  await expect(canvas).toBeFocused();
  await expect(results.getByRole('alert')).toHaveCount(0);
  expect(submitted()).toBe(1);
  const slider = results.getByRole('slider', { name: 'Simulation time', exact: true });
  await slider.fill('0.5');
  await expect(slider).toHaveAttribute('aria-valuetext', '0.50 seconds');
  await expect(results.getByLabel('Current simulation time')).toHaveAttribute('aria-live', 'off');
  await page.emulateMedia({ forcedColors: 'active' });
  await slider.press('ArrowRight');
  const focus = await slider.evaluate(element => {
    const css = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outline: css.outlineStyle, width: parseFloat(css.outlineWidth) };
  });
  expect(focus.visible).toBe(true);
  expect(focus.outline).toBe('solid');
  expect(focus.width).toBeGreaterThanOrEqual(2);
});
