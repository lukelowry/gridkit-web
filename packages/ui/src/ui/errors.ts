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
