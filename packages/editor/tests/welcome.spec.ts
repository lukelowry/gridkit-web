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
  await expect(page.locator('.case-name')).toHaveText(fixture.header.case_name);
  await page.getByRole('button', { name: 'GridKit home', exact: true }).click();
  await page.getByRole('button', { name: 'Return home', exact: true }).click();
  await expect(library).toBeFocused();
});

test('removes only the obsolete snapshots and never saves or restores an edited case', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.evaluate(async () => {
    for (const name of ['gridkit-recovery', 'unrelated-data']) await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('sessions');
        request.result.createObjectStore('snapshots');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['sessions', 'snapshots'], 'readwrite');
        tx.objectStore('sessions').put({ title: 'Old case', savedAt: Date.now() }, 'old');
        tx.objectStore('snapshots').put({ case: '{}' }, 'old');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    localStorage.setItem('gridkit.preferences', JSON.stringify({ theme: 'dark' }));
  });
  await page.reload();
  const databases = () => page.evaluate(async () => (await indexedDB.databases()).map(db => db.name));
  await expect.poll(databases).not.toContain('gridkit-recovery');
  expect(await databases()).toContain('unrelated-data');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gridkit.preferences')!).theme)).toBe('dark');
  await expect(page.getByRole('region', { name: 'Recovery', exact: true })).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Open file…', exact: true });
  await expect(open).toHaveClass(/primary/);
  const choosing = page.waitForEvent('filechooser');
  await open.click();
  await (await choosing).setFiles({ name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('gridcell', { name: 'North', exact: true }).dblclick();
  await page.getByLabel('Element name').fill('Unsaved edit');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Welcome', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Case information:/ })).toHaveCount(0);
  expect(await databases()).not.toContain('gridkit-recovery');
});

test('opening files does not require browser storage', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Storage unavailable'); } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open file…', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({ name: 'example.case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.locator('.case-name')).toHaveText(fixture.header.case_name);
});
