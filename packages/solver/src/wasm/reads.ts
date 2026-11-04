import { SolverError, type Cursor, type RowsQuery, type SummaryQuery, type TileDescription } from '../index.js';
import type { Extent, Store } from './store.js';

/** The solver service's limits on a read, which the solver in this page keeps too. */
const maxReadBytes = 8 << 20, maxStreamBytes = 64 << 20, maxStreamRows = 65536;
const invalid = (message: string) => new SolverError('invalid', message);

/** A rows query as the solver service checks it, before any wait for more rows. */
export function checkRows(store: Store, query: RowsQuery) {
  const columns = store.selection(query.columns), from = query.from ?? 0, every = query.every || 1, count = query.count ?? 0;
  if (!columns.length || from < 0 || every < 0 || count < 0 || query.maxBytes <= 0 || query.maxBytes > maxReadBytes) throw invalid('Invalid read.');
  let capacity = Math.floor(query.maxBytes / (8 * (1 + columns.length)));
  if (count > 0) capacity = Math.min(capacity, count);
  if (!capacity) throw invalid('The budget cannot fit a complete row.');
  return { columns, from, every, capacity, at: query.at };
}

/** Exact rows of some columns: from a row, or the last at or before a time. */
export function readRows(store: Store, view: Extent, { columns, from, every, capacity, at }: ReturnType<typeof checkRows>) {
  let first = from, count = 0;
  if (at !== undefined) [first, count] = store.around(view.rows, at, capacity);
  else if (view.rows > from) count = Math.min(capacity, Math.ceil((view.rows - from) / every));
  return { first, count, values: count ? store.sampled(first, count, every, columns) : new Float64Array() };
}

/** A summary query's columns, as the solver service checks it, before any wait for more rows. */
export function checkSummary(store: Store, query: SummaryQuery) {
  const columns = store.selection(query.columns), { resolution, maxBytes, range } = query;
  if (!columns.length) throw invalid('Choose columns to summarize.');
  if (resolution <= 0 || resolution > maxStreamRows || maxBytes < 4096 || maxBytes > maxStreamBytes) throw invalid('The summary\'s budget is outside the supported range.');
  if (range && range[0] > range[1]) throw invalid('Invalid time range.');
  if (16 * (columns.length + 1) > maxBytes) throw invalid('The selection is too wide for the summary\'s budget.');
  return columns;
}

/** Partitions rows into aligned entries, finer at the edges, so no partial bucket is ever labelled as whole. */
export function tiles(target: TileDescription['target'], first: number, last: number, level: number, columns: number, maxBytes: number): TileDescription[] {
  const out: TileDescription[] = [];
  for (let position = first; position < last;) {
    let power = 0, span = 1, kind: TileDescription['kind'] = 'samples', planes = 1;
    while (power < level && position % (span * 8) === 0 && position + span * 8 <= last) {
      power++; span *= 8; kind = 'envelope'; planes = 2;
    }
    const capacity = Math.floor(maxBytes / (8 * (columns + 1) * planes));
    let end = position + span;
    while (end + span <= last && (end - position) / span < capacity && (power === level || end % (span * 8) !== 0)) end += span;
    out.push({ target, kind, level: power, first: position / span, rows: (end - position) / span });
    position = end;
  }
  return out;
}

/** Plans one revision: the history a reader lacks, then the edges around it, which no history holds yet. */
export function summarize(store: Store, view: Extent, query: SummaryQuery, columns: number): { reset: boolean; cursor: Cursor; tiles: TileDescription[] } {
  const [first, last] = store.interval(view, query.range), period = query.range ?? [view.start, view.end];
  const pixel = (period[1] - period[0]) / query.resolution;
  let level = 0, span = 1;
  while (view.step > 0 && span * 8 * view.step <= pixel) { level++; span *= 8; }
  const start = Math.ceil(first / span) * span, end = Math.floor(last / span) * span, held = query.cursor;
  const reset = !held || held.level !== level || held.first !== first, from = reset ? start : Math.max(start, held.sealed);
  const planned = end > from ? tiles('history', from, end, level, columns, query.maxBytes) : [];
  if (end < start) planned.push(...tiles('edge', first, last, level, columns, query.maxBytes));
  else planned.push(...tiles('edge', first, Math.min(start, last), level, columns, query.maxBytes),
    ...tiles('edge', Math.max(end, first), last, level, columns, query.maxBytes));
  return { reset, cursor: { level, first, sealed: Math.max(start, end) }, tiles: planned };
}
