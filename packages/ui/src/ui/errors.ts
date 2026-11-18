/**
 * What to tell the user about `cause`: its own message, else `fallback`. An error without one, as a worker that could not load
 * raises, never silences what failed.
 */
export function errorMessage(cause: unknown, fallback = 'Something went wrong.') {
  const message = typeof cause === 'string' ? cause : (cause as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** What a message offers when only a new page recovers: files replaced since this one opened, or a runtime that stopped. */
export const reload = { label: 'Reload application', run: () => window.location.reload() };

/** Whether the site was redeployed since load: its index no longer names this page's entry script. False if unreadable. */
export async function replaced(): Promise<boolean> {
  const entry = document.querySelector('script[type="module"][src]')?.getAttribute('src')?.split('/').pop();
  if (!entry) return false;
  const page = await fetch(document.baseURI, { cache: 'no-store' }).catch(() => null);
  return !!page?.ok && !(await page.text()).includes(entry);
}
