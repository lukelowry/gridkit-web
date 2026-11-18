import { SolverError, type EntriesQuery, type RowsQuery } from '../index.js';
import type { Extent, Store } from './store.js';

/** The solver service's limit on a read, which the solver in this page keeps too: a span of 8 coarse entries of 100k columns. */
const maxReadBytes = 16 << 20;
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

/** An entries query's columns, as the solver service checks it. */
export function checkEntries(store: Store, { columns: names, level, first, count, maxBytes }: EntriesQuery) {
  const columns = store.selection(names), planes = level ? 2 : 1;
  if (!columns.length || !Number.isInteger(level) || level < 0 || level >= store.levels || first < 0 || count <= 0 ||
    maxBytes > maxReadBytes || 8 * planes * count * (1 + columns.length) > maxBytes) throw invalid('Invalid read.');
  return columns;
}

/** Entries of one level: whole ones only. */
export function readEntries(store: Store, view: Extent, columns: readonly number[], { level, first, count }: EntriesQuery) {
  const held = Math.max(0, Math.min(count, Math.floor(view.rows / 8 ** level) - first));
  return { first, count: held, values: held ? store.planes(level, first, held, columns) : new Float64Array() };
}
