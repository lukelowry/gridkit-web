import { test, expect } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };

test('mobile navigation controls meet the bottom edge while respecting top and side insets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const rail = page.getByRole('navigation', { name: 'Views', exact: true });
  await rail.getByRole('button', { name: 'Table', exact: true }).click();

  for (const sample of [
    { width: 390, height: 844, top: 47, right: 0, bottom: 34, left: 0 },
    { width: 667, height: 375, top: 0, right: 44, bottom: 21, left: 44 },
    { width: 320, height: 568, top: 0, right: 0, bottom: 0, left: 0 },
    { width: 390, height: 640, top: 20, right: 0, bottom: 34, left: 0 },
  ]) {
    await page.setViewportSize({ width: sample.width, height: sample.height });
    // Desktop browser automation does not expose a device's hardware insets.
    await page.evaluate(({ top, right, bottom, left }) => {
      for (const [side, value] of Object.entries({ top, right, bottom, left }))
        document.documentElement.style.setProperty(`--safe-${side}`, `${value}px`);
    }, sample);
    await expect.poll(() => rail.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return Math.abs(bounds.bottom - innerHeight);
    })).toBeLessThan(1);
    const layout = await rail.evaluate((element, { top, right, left }) => {
      const bounds = element.getBoundingClientRect(), main = document.querySelector('main')!.getBoundingClientRect();
      const workspace = document.querySelector('.view-area')!.getBoundingClientRect();
      const buttons = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      return {
        fullWidth: bounds.left === 0 && bounds.right === innerWidth,
        controlsSafe: buttons.every(button => button.left >= left && button.right <= innerWidth - right),
        controlsAtBottom: buttons.every(button => Math.abs(innerHeight - button.bottom - 2) < 1),
        headerSafe: document.querySelector('.identity')!.getBoundingClientRect().top >= top,
        workspaceSafe: workspace.left >= left && workspace.right <= innerWidth - right,
        adjoining: Math.abs(main.bottom - bounds.top) < 1,
        noDocumentScroll: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth,
      };
    }, sample);
    expect(layout).toEqual({ fullWidth: true, controlsSafe: true, controlsAtBottom: true, headerSafe: true, workspaceSafe: true, adjoining: true, noDocumentScroll: true });
  }

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await rail.getByRole('button', { name: 'Preferences', exact: true }).press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect.poll(() => rail.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - innerHeight))).toBeLessThan(1);
  const focused = await rail.getByRole('button', { name: 'Preferences', exact: true }).evaluate(element => {
    const css = getComputedStyle(element);
    return { style: css.outlineStyle, width: parseFloat(css.outlineWidth), offset: parseFloat(css.outlineOffset) };
  });
  expect(focused.style).toBe('solid');
  expect(focused.width + focused.offset).toBeLessThanOrEqual(0);
  await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
  await rail.getByRole('button', { name: 'Preferences', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close preferences', exact: true }).click();
  await expect(rail.getByRole('button', { name: 'Preferences', exact: true })).toBeFocused();
});
