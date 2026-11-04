import { reference, type Fields, type Patch, type Row, type Rows } from 'latkit';
import { collections, elementCatalog, elementFields, portsOf, targetOf, type CaseDocument, type Connection, type ElementRecord, type ElementRef, type ElementTarget, type PortDefinition } from '@gridkit/library';

/** The dataset each view draws, a dataset of its own. Row ids are element identities, so a hit names its element directly. */
export const dataset = 'case';

// Data tables include unrendered models so Network expressions can still join their fields.
export function tableOf(target: ElementTarget): string | null {
  if (target.collection === 'signals') return 'Signal';
  if (target.collection === 'buses') return 'Bus';
  return elementCatalog.get(target.class ?? '')?.collection === 'devices' ? target.class! : null;
}
/** The elements a table holds, whose fields it writes. */
export const targetOfTable = (table: string): ElementTarget => table === 'Bus' ? { collection: 'buses' } : table === 'Signal' ? { collection: 'signals' }
  : { collection: 'devices', class: table };
export const refOf = (row: Pick<Row, 'table' | 'id'>): ElementRef => ({ collection: targetOfTable(row.table).collection, id: String(row.id) });
export function rowsOf(document: CaseDocument, ref: ElementRef | null): Rows[] {
  const row = ref && document.get(ref), table = row && tableOf(targetOf(row));
  return table ? [{ data: dataset, table, ids: [row.ref.id] }] : [];
}
// A case places its buses as it opens, so where it places them changes only as buses come and go.
const geographies = new WeakMap<CaseDocument, { numbering: number; geographic: boolean }>();
export function isGeographic(document: CaseDocument): boolean {
  const kept = geographies.get(document);
  if (kept?.numbering === document.numbering) return kept.geographic;
  const geographic = document.rows('buses').some(row => row.placement.geographic);
  geographies.set(document, { numbering: document.numbering, geographic });
  return geographic;
}

/** Each drawn table's rows in storage order. Bus and Signal always exist; marks may name them before any row does. */
export function tables(document: CaseDocument): Map<string, readonly ElementRecord[]> {
  const result = new Map<string, ElementRecord[]>([['Bus', []], ['Signal', []]]);
  for (const collection of collections) {
    const named = new Map<unknown, ElementRecord[] | null>();
    for (const row of document.rows(collection)) {
      let rows = named.get(row.value.class);
      if (rows === undefined) {
        const table = tableOf(targetOf(row));
        named.set(row.value.class, rows = table ? result.get(table) ?? result.set(table, []).get(table)! : null);
      }
      rows?.push(row);
    }
  }
  return result;
}

const id = (connection: Connection | undefined) => connection !== undefined && typeof connection !== 'number' ? connection.id : null;

/** A field a table is written with: its name, its kind, and its values for rows given with their elements' fields. */
export type Column = readonly [name: string, kind: string, values: (rows: readonly ElementRecord[], fields: readonly Record<string, unknown>[]) => Fields[string]];

/** Columns preserve scalar field kinds and connections by element identity. */
export function tableColumns(document: CaseDocument, table: string): Column[] {
  const columns: Column[] = [];
  for (const { id: name, kind } of document.fields(targetOfTable(table))) {
    if (name === 'uuid' || name.startsWith('ports.')) continue;
    if (kind === 'number') columns.push([name, kind, (_, values) => Float64Array.from(values, row => typeof row[name] === 'number' ? row[name] : NaN)]);
    else if (kind === 'text') columns.push([name, kind, (_, values) => values.map(row => typeof row[name] === 'string' ? row[name] : null)]);
    else if (kind === 'bool') columns.push([name, kind, (_, values) => values.map(row => typeof row[name] === 'boolean' ? row[name] : null)]);
  }
  const port = (name: string, { target }: PortDefinition): Column =>
    [`ports.${name}`, 'reference', rows => reference(target === 'buses' ? 'Bus' : 'Signal', rows.map(row => id(portsOf(row)[name])))];
  for (const [name, item] of Object.entries(elementCatalog.get(table)?.ports ?? {})) columns.push(port(name, item));
  return columns;
}

function fieldsOf(columns: readonly Column[], rows: readonly ElementRecord[]): Record<string, Fields[string]> {
  const values = rows.map(elementFields);
  return Object.fromEntries(columns.map(([name, , write]) => [name, write(rows, values)]));
}
/** Writes `rows` of `table` by its `columns`: replacing the table with them, or setting them over it. */
export function writeRows(patch: Patch, table: string, columns: readonly Column[], rows: readonly ElementRecord[], replace: boolean) {
  const ids = rows.map(row => row.ref.id), fields = fieldsOf(columns, rows);
  if (replace) patch.replace(table, ids, fields); else patch.set(table, ids, fields);
}

// A column's values: numbers, texts, or flags as they are, and a reference as its ids.
const items = (values: Fields[string]) => ('reference' in values ? values.ids : values) as ArrayLike<unknown>;
const same = (a: Fields[string], b: Fields[string]) => {
  const [x, y] = [items(a), items(b)];
  if (x.length !== y.length) return false;
  for (let index = 0; index < x.length; index++) if (!Object.is(x[index], y[index])) return false;
  return true;
};
/** The `columns` whose values `rows` change from their versions `before`: setting only these leaves latkit the rest. */
export function changedColumns(columns: readonly Column[], before: readonly ElementRecord[], rows: readonly ElementRecord[]): Column[] {
  const was = before.map(elementFields), now = rows.map(elementFields);
  return columns.filter(([, , values]) => !same(values(before, was), values(rows, now)));
}

/** A table as a view last wrote it. */
interface Kept {
  shape: string;
  rows: Map<string, ElementRecord>;
}
/** A view's tables as it last wrote them. */
export type Written = Map<string, Kept>;

/**
 * Writes into `patch` what `next` changes since `written`: a table whole when its fields
 * change; else its rows that come, go, or change, by identity, with only the fields they change. latkit evaluates only the
 * pages a patch writes.
 */
export function writeChanges(patch: Patch, written: Written, next: ReadonlyMap<string, readonly ElementRecord[]>,
  columnsOf: (table: string) => readonly Column[]): boolean {
  let changed = false;
  for (const [table, rows] of next) {
    const columns = columnsOf(table), shape = columns.map(([name, kind]) => `${name}:${kind}`).join('\n');
    const kept = written.get(table);
    if (kept?.shape === shape) {
      const update = writeTable(patch, table, kept, columns, rows);
      changed ||= update;
      continue;
    }
    writeRows(patch, table, columns, rows, true);
    written.set(table, { shape, rows: new Map(rows.map(row => [row.ref.id, row])) });
    changed = true;
  }
  for (const table of written.keys()) if (!next.has(table)) {
    patch.replace(table, [], {});
    written.delete(table);
    changed = true;
  }
  return changed;
}
/** Writes only added/removed rows and changed fields. */
function writeTable(patch: Patch, table: string, kept: Kept, columns: readonly Column[], rows: readonly ElementRecord[]): boolean {
  const dirty = rows.filter(row => kept.rows.get(row.ref.id) !== row);
  if (!dirty.length && rows.length === kept.rows.size) return false;
  // New rows take every field; changed ones only the fields they change. Every row held before is still here when the rows
  // it already held account for all of them.
  const added = dirty.filter(row => !kept.rows.has(row.ref.id)), edited = dirty.filter(row => kept.rows.has(row.ref.id));
  const ids = rows.length - added.length === kept.rows.size ? null : new Set(rows.map(row => row.ref.id));
  const removed = ids ? [...kept.rows.keys()].filter(id => !ids.has(id)) : [];
  const fields = changedColumns(columns, edited.map(row => kept.rows.get(row.ref.id)!), edited);
  for (const id of removed) kept.rows.delete(id);
  for (const row of dirty) kept.rows.set(row.ref.id, row);
  if (removed.length) patch.remove(table, removed);
  if (added.length) writeRows(patch, table, columns, added, false);
  if (fields.length) writeRows(patch, table, fields, edited, false);
  return removed.length + added.length + fields.length > 0;
}
