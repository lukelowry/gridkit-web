import { isTerminal, runStates, SolverError, type RunId } from '../index.js';
import type { RunStatus } from '../protocol.js';
import type { Backend, Report } from '../serve.js';
import { rowsReply, summaryReply } from './frames.js';
import type { Options } from './index.js';

/** The failure a service answered with, as `{ code, message }`, else one naming its status. */
async function failureOf(response: Response) {
  const { code, message } = await response.json().catch(() => ({})) as { code?: unknown; message?: unknown };
  return new SolverError(typeof code === 'string' ? code : 'unavailable', typeof message === 'string' ? message : `The solver answered ${response.status}.`);
}
/** What the service answered; nothing it answers is kept by a cache. */
async function call(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (!response.ok) throw await failureOf(response);
  return response;
}
const post = (body: unknown, signal: AbortSignal): RequestInit =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });

const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const range = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1];
const text = (value: unknown) => typeof value === 'string';
/** A run's status as the service says it, refused where it does not hold together. */
function statusOf(value: unknown): RunStatus {
  const { sequence, state, rows, range: covered, error } = (value ?? {}) as Record<string, unknown>;
  const { code, message } = (error ?? {}) as Record<string, unknown>;
  const valid = count(sequence) && count(rows) && runStates.includes(state as never)
    && (covered === null ? state !== 'completed' : range(covered))
    && (state !== 'completed' || rows > 0) && (state !== 'failed' || (text(code) && text(message)));
  if (!valid) throw new SolverError('protocol', 'Invalid solver status.');
  return value as RunStatus;
}
/** The name the service gave the run it accepted. */
async function accepted(response: Response) {
  const { id } = (await response.json().catch(() => null) ?? {}) as { id?: unknown };
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new SolverError('protocol', 'Invalid solver run.');
  return id;
}

/**
 * The solver service at `base`, or null where nothing answers there: a host without one answers 404, or its own page. The service
 * keeps one run, its rows read back beneath its address, and offers its files there for the browser to download.
 */
export async function open({ base }: Options, report: Report): Promise<Backend | null> {
  base = base.replace(/\/*$/, '/');
  const root = await fetch(base, { cache: 'no-store' });
  if (!root.ok && root.status !== 404) throw await failureOf(root);
  void root.body?.cancel();
  if (root.status === 404 || root.headers.get('content-type')?.startsWith('text/html')) return null;

  const life = new AbortController();
  /** Each run this page started that the service may hold: its upload, then its address once the service accepts it. */
  const runs = new Map<RunId, { uploading: AbortController; address?: string }>();
  const address = (run: RunId) => {
    const held = runs.get(run);
    if (!held) throw new SolverError('expired', 'This simulation has expired.');
    if (!held.address) throw new SolverError('unavailable', 'Nothing is recorded yet.');
    return held.address;
  };
  /** Each change of the run's status, from the service's long-poll, until it ends. */
  const follow = async (run: RunId, at: string) => {
    try {
      for (let sequence = -1; ;) {
        const status = statusOf(await (await call(`${at}?after=${sequence}`, { signal: life.signal })).json().catch(() => null));
        sequence = status.sequence;
        report.status(run, status);
        if (isTerminal(status.state)) return;
      }
    } catch (cause) { if (!life.signal.aborted) report.lost(run, cause); }
  };
  return {
    async start(run, { study, model }) {
      const held: { uploading: AbortController; address?: string } = { uploading: new AbortController() };
      runs.set(run, held);
      // The study and its model go up in one body, the model streamed from its blob.
      const form = new FormData();
      form.set('solver', new Blob([JSON.stringify(study)], { type: 'application/json' }));
      form.set('model', model);
      let id: string;
      try { id = await accepted(await call(`${base}runs`, { method: 'POST', body: form, signal: AbortSignal.any([held.uploading.signal, life.signal]) })); }
      catch (cause) {
        // Abandoned before the service took it: nothing is left to stop.
        if (held.uploading.signal.aborted) { report.status(run, { sequence: 0, state: 'cancelled', rows: 0, range: null }); return; }
        runs.delete(run);
        throw cause;
      }
      held.address = `${base}runs/${id}`;
      // Accepting a run retires the one before it.
      for (const other of runs.keys()) if (other !== run) runs.delete(other);
      void follow(run, held.address);
    },
    async cancel(run) {
      const held = runs.get(run);
      if (!held) return;
      if (!held.address) { held.uploading.abort(); return; }
      await call(`${held.address}/cancel`, { method: 'POST' });
    },
    rows: async (run, query, signal) => rowsReply(await call(`${address(run)}/rows`, post(query, signal)), query),
    summary: async (run, query, signal) => summaryReply(await call(`${address(run)}/summary`, post(query, signal)), query),
    // The service writes each file; the browser downloads it from there, and the page holds none of it.
    artifact: async (run, name) => ({ header: { href: `${address(run)}/${name}` }, parts: [] }),
    close() { life.abort(); runs.clear(); },
  };
}
