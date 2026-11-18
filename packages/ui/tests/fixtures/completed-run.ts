import type { Page } from '@playwright/test';

/** A completed run with real binary rows; no runtime service required. */
export async function completedRun(page: Page) {
  let submitted = 0;
  await page.route('**/api/solver/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/runs')) { submitted++; return route.fulfill({ json: { id: 'harden-test' } }); }
    if (path.endsWith('/runs/harden-test')) return route.fulfill({ json: { sequence: 1, state: 'completed', rows: 2, range: [0, 1] } });
    // Rows, or entries of level 0: two rows hold no coarser level.
    if (path.endsWith('/rows') || path.endsWith('/entries')) {
      const query = route.request().postDataJSON(), count = Math.min(query.count || 2, 2);
      const header = Buffer.from(JSON.stringify({ rows: 2, state: 'completed', range: [0, 1], first: 0, count }));
      const size = Buffer.alloc(4); size.writeUInt32LE(header.length);
      const data = Buffer.alloc(8 * count * (1 + query.columns.length));
      for (let row = 0; row < count; row++) {
        data.writeDoubleLE(row, row * 8);
        for (let column = 0; column < query.columns.length; column++)
          data.writeDoubleLE(1 + column * 0.1 - row * 0.3, (count + row * query.columns.length + column) * 8);
      }
      return route.fulfill({ contentType: 'application/octet-stream', body: Buffer.concat([size, header, data]) });
    }
    return route.fulfill({ json: {} });
  });
  return () => submitted;
}
