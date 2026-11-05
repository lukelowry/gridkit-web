import { test, expect } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open case file', { exact: true }).setInputFiles({
    name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
});

test('header command menus share arrow navigation, typeahead, disabled actions and focus return', async ({ page }) => {
  const brand = page.getByRole('button', { name: 'GridKit menu', exact: true });
  const menu = page.getByRole('menu', { name: 'GridKit menu', exact: true });
  await brand.focus();
  await brand.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Return home', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Case information', exact: true })).toBeFocused();
  await page.keyboard.press('d');
  await expect(menu.getByRole('menuitem', { name: 'Download case', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(brand).toBeFocused();
  await expect(brand).toHaveAttribute('aria-expanded', 'false');
  await brand.click();
  await expect(menu.getByRole('menuitem', { name: 'Case information', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).not.toBeVisible();
  await expect(brand).not.toBeFocused();
  await page.getByRole('button', { name: 'Solver', exact: true }).click();
  const options = page.getByRole('button', { name: 'Solver options', exact: true });
  await options.press('ArrowDown');
  const review = page.getByRole('menuitem', { name: 'Check settings', exact: true });
  await expect(review).toBeFocused();
  await expect(review).toBeDisabled();
  await review.press('Enter');
  await expect(page.getByRole('menu', { name: 'Solver options', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Reset solver settings', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(options).toBeFocused();
  await options.click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('menu')).toHaveCount(0);
});
