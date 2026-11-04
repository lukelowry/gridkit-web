import { test, expect, type Locator, type Page } from '@playwright/test';
import fixture from '../../library/test/small.case.json' with { type: 'json' };

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

// Catch transient input focus too: a final button focus can hide a keyboard flash.
declare global { interface Window { typingFocus: string[] } }
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.typingFocus = [];
    document.addEventListener('focusin', event => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && ['text', 'search', 'number', 'url', 'email', 'tel', 'password'].includes(target.type)))) {
        window.typingFocus.push(target.getAttribute('aria-label') || target.id || target.tagName);
      }
    });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByRole('button', { name: 'Table', exact: true }).tap();
});

async function browsing(page: Page, action: () => Promise<unknown>, target: Locator) {
  await page.evaluate(() => { window.typingFocus = []; });
  await action();
  await expect(target).toBeFocused();
  expect(await page.evaluate(() => window.typingFocus)).toEqual([]);
}

test('touch browsing never focuses search in settings, classes, columns, connections, models, or mappings', async ({ page }) => {
  const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
  const preferencesButton = page.getByRole('button', { name: 'Preferences', exact: true });
  await browsing(page, () => preferencesButton.tap(), preferences.getByRole('button', { name: 'Close preferences' }));
  await browsing(page, () => preferences.getByRole('button', { name: 'Cancel', exact: true }).tap(), preferencesButton);

  const classes = page.getByRole('dialog', { name: 'Table class', exact: true });
  const classButton = page.getByRole('button', { name: 'Table class', exact: true });
  await browsing(page, () => classButton.tap(), classes.getByRole('button', { name: 'All classes', exact: true }));
  await browsing(page, () => classes.getByRole('button', { name: 'Branch', exact: true }).tap(), classButton);
  await browsing(page, () => classButton.tap(), classes.getByRole('button', { name: 'Branch', exact: true }));
  await browsing(page, () => page.keyboard.press('Escape'), classButton);

  const columnsButton = page.getByRole('button', { name: 'Columns', exact: true });
  const columns = page.getByRole('dialog', { name: 'Columns', exact: true });
  await browsing(page, () => columnsButton.tap(), columns.getByRole('button', { name: 'Close columns' }));
  await expect(columns.getByRole('searchbox', { name: 'Find columns' })).toBeVisible();
  await browsing(page, () => page.keyboard.press('Escape'), columnsButton);

  const properties = page.getByRole('dialog', { name: 'Branch line-1', exact: true });
  await browsing(page, () => page.getByRole('gridcell', { name: 'line-1', exact: true }).dblclick(),
    properties.getByRole('button', { name: 'Close element' }));
  const connection = properties.getByRole('combobox', { name: 'From bus', exact: true });
  const buses = page.getByRole('dialog', { name: 'From bus', exact: true }).getByRole('grid', { name: 'Buses', exact: true });
  await browsing(page, () => connection.tap(), buses);
  await browsing(page, () => page.keyboard.press('Escape'), connection);
  await properties.getByRole('button', { name: 'Cancel', exact: true }).tap();

  const models = page.getByRole('dialog', { name: 'Add model', exact: true });
  const add = page.getByRole('button', { name: 'Add model', exact: true });
  await browsing(page, () => add.tap(), models.getByRole('button').first());
  await browsing(page, () => models.getByRole('button', { name: 'Exciter', exact: true }).tap(),
    models.getByRole('button', { name: 'ESDC1A', exact: true }));
  await browsing(page, () => models.getByRole('button', { name: /All models/ }).tap(),
    models.getByRole('button', { name: 'Exciter', exact: true }));
  // Returning to a family below the fold must reveal it as well as focus it.
  await models.getByRole('button', { name: 'Source', exact: true }).tap();
  const source = models.getByRole('button', { name: 'Source', exact: true });
  await browsing(page, () => models.getByRole('button', { name: /All models/ }).tap(), source);
  await expect(source).toBeInViewport();
  await browsing(page, () => page.keyboard.press('Escape'), add);

  await preferencesButton.tap();
  await preferences.getByRole('combobox', { name: 'Settings section' }).selectOption({ label: 'Network mappings' });
  const mappingButton = preferences.getByRole('button', { name: 'Color mapping', exact: true });
  const mapping = page.getByRole('dialog', { name: 'Color mapping', exact: true });
  await browsing(page, () => mappingButton.tap(), mapping.getByRole('button', { name: /^Default/ }));
  await browsing(page, () => page.keyboard.press('Escape'), mappingButton);
});

test('clearing preserves active typing but never starts it from browsing or a keyboard action', async ({ page }) => {
  const input = page.getByRole('searchbox', { name: 'Search elements', exact: true });
  const group = page.getByRole('group', { name: 'Search elements', exact: true });
  const clear = group.getByRole('button', { name: 'Clear search' });
  await input.tap();
  await input.fill('North');
  await clear.tap();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');

  await input.fill('North');
  await page.getByRole('gridcell', { name: 'North', exact: true }).tap();
  await browsing(page, () => clear.tap(), group);
  await expect(input).toHaveValue('');
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.fill('South');
  await input.press('Tab');
  await expect(clear).toBeFocused();
  await browsing(page, () => page.keyboard.press('Enter'), group);
});

test('reset and empty search recovery keep focus on stable non-editing targets', async ({ page }) => {
  await page.getByRole('button', { name: 'Preferences', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
  await dialog.getByRole('combobox', { name: 'Settings section' }).selectOption({ label: 'Interaction' });
  const label = 'Interaction Navigation Picking tolerance';
  const value = dialog.getByRole('spinbutton', { name: label, exact: true });
  const baseline = await value.inputValue();
  await value.fill('12');
  await value.press('Tab');
  await browsing(page, () => dialog.getByRole('button', { name: `Reset ${label}`, exact: true }).tap(),
    dialog.getByRole('group', { name: label, exact: true }));
  await expect(value).toHaveValue(baseline);
  await expect(dialog.getByRole('status').filter({ hasText: 'reset to default' })).toHaveText(`${label} reset to default.`);
  await page.keyboard.press('Tab');
  await expect(value).toBeFocused();

  await value.fill('12');
  await value.press('Tab');
  await browsing(page, () => dialog.getByRole('button', { name: 'Reset Interaction section' }).tap(),
    dialog.getByRole('heading', { name: 'Interaction', exact: true }));
  await expect(value).toHaveValue(baseline);
  await dialog.getByRole('searchbox', { name: 'Search preferences' }).fill('no-matching-preference');
  await browsing(page, () => dialog.getByRole('button', { name: 'Clear search', exact: true }).last().tap(),
    dialog.getByRole('group', { name: 'Search preferences', exact: true }));
  await expect(dialog.getByRole('searchbox')).toHaveValue('');
});

test('global search opens and closes properties without an intermediate input focus', async ({ page }) => {
  await page.getByRole('button', { name: 'Network', exact: true }).tap();
  const search = page.getByRole('combobox', { name: 'Search elements', exact: true });
  const group = page.getByRole('group', { name: 'Search elements', exact: true });
  await search.tap();
  await search.fill('North');
  const results = page.getByRole('grid', { name: 'Search results', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Bus 1', exact: true });
  await browsing(page, () => results.getByRole('gridcell', { name: 'North', exact: true }).tap(),
    dialog.getByRole('button', { name: 'Close element' }));
  await browsing(page, () => dialog.getByRole('button', { name: 'Close element' }).tap(), group);
  await expect(results).not.toBeVisible();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await search.fill('North');
  await search.press('ArrowDown');
  await expect(results).toBeFocused();
  await browsing(page, () => page.keyboard.press('Escape'), group);
  await expect(results).not.toBeVisible();
});

test('keyboard selection, deliberate typing, validation, and light dismissal retain meaningful focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  const classButton = page.getByRole('button', { name: 'Table class', exact: true });
  const classes = page.getByRole('dialog', { name: 'Table class', exact: true });
  await classButton.focus();
  await browsing(page, () => page.keyboard.press('Enter'), classes.getByRole('button', { name: 'All classes', exact: true }));
  await page.keyboard.press('Shift+Tab');
  await expect(classes.getByRole('searchbox')).toBeFocused();
  await classes.getByRole('searchbox').fill('Branch');
  await browsing(page, () => page.getByRole('button', { name: 'Preferences', exact: true }).click(),
    page.getByRole('button', { name: 'Close preferences' }));
  await expect(classes).not.toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('gridcell', { name: 'line-1', exact: true }).dblclick();
  const branch = page.getByRole('dialog', { name: 'Branch line-1', exact: true });
  const connection = branch.getByRole('combobox', { name: 'From bus', exact: true });
  const buses = page.getByRole('grid', { name: 'Buses', exact: true });
  await connection.focus();
  await browsing(page, () => page.keyboard.press('ArrowDown'), buses);
  await page.keyboard.press('End');
  await browsing(page, () => page.keyboard.press('Enter'), connection);
  await expect(connection).toContainText('2 — South');
  await branch.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  const bus = page.getByRole('dialog', { name: 'Bus 1', exact: true });
  const number = bus.getByLabel('Number', { exact: true });
  await number.click();
  await expect(number).toBeFocused();
  await number.fill('2');
  await bus.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(number).toBeFocused();
  await expect(number).toHaveAttribute('aria-invalid', 'true');
  await expect(number).toHaveValue('2');
});
