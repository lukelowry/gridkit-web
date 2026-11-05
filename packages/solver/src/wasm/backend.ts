import { SolverError, type ArtifactName, type RunId } from '../index.js';
import type { Backend, Report } from '../serve.js';
import { settingsOf } from './gridkit.js';
import { Host, type HostDeps } from './host.js';

/** What the in-page solver runs on: files for each run, and GridKit for each study. */
export type Side = Omit<HostDeps, 'status'>;

/**
 * GridKit in this page as a solver's backend: one run at a time, its rows kept in `side`'s files and read back as the solver
 * service reads them. Its log and settings are links the browser downloads; its recording is written as CSV only when asked.
 */
export function wasmBackend(side: Side, report: Report): Backend {
  /** What each run held offers besides its recording, and the links made of it, released with the run. */
  const held = new Map<RunId, { settings: string; log?: string; links: string[] }>();
  const host = new Host({ ...side, status(run, status, log) {
    const kept = held.get(run);
    if (kept && log !== undefined) kept.log = log;
    report.status(run, status);
  } });
  const release = (run: RunId) => {
    for (const link of held.get(run)?.links ?? []) URL.revokeObjectURL(link);
    held.delete(run);
  };
  const link = (run: RunId, name: Exclude<ArtifactName, 'results'>) => {
    const kept = held.get(run), text = name === 'log' ? kept?.log : kept?.settings;
    if (!kept || text === undefined) throw new SolverError('unavailable', 'This run has not ended.');
    const href = URL.createObjectURL(new Blob([text], { type: name === 'log' ? 'text/plain' : 'application/json' }));
    kept.links.push(href);
    return href;
  };
  return {
    async start(run, { study, model }) {
      const settings = settingsOf(study, 'model.json', '/run/rows');
      held.set(run, { settings: JSON.stringify(settings, null, 2), links: [] });
      try { await host.start(run, { settings, model }); }
      catch (cause) { release(run); throw cause; }
      // Starting a run retired the one before it.
      for (const other of [...held.keys()]) if (other !== run) release(other);
    },
    cancel: run => host.cancel(run),
    rows: (run, query) => host.rows(run, query),
    summary: (run, query) => host.summary(run, query),
    async artifact(run, name) {
      return name === 'results' ? { header: {}, parts: host.csv(run) } : { header: { href: link(run, name) }, parts: [] };
    },
    close() { for (const run of [...held.keys()]) release(run); },
  };
}
