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
// Geographic placement is fixed for the lifetime of an imported document.
const geographies = new WeakMap<CaseDocument, boolean>();
export function isGeographic(document: CaseDocument): boolean {
  const kept = geographies.get(document);
  if (kept !== undefined) return kept;
  const geographic = document.rows('buses').some(row => row.placement.geographic);
  geographies.set(document, geographic);
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
/** Writes one immutable case table. */
export function writeRows(patch: Patch, table: string, columns: readonly Column[], rows: readonly ElementRecord[]) {
  patch.replace(table, rows.map(row => row.ref.id), fieldsOf(columns, rows));
}
