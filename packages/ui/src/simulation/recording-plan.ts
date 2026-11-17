import type { ElementTarget } from '@gridkit/library';
import type { Channel } from '@gridkit/library/gridkit';

/** Sample tables mirror case tables, keeping unrelated device models out of each other's columns. */
export function recordingTable(target: ElementTarget): string {
  if (target.collection === 'buses') return 'Bus';
  if (target.collection === 'signals') return 'Signal';
  if (!target.class) throw new Error('A device recording requires its model class.');
  return target.class;
}

export interface RecordedField {
  readonly name: string;
  readonly entries: readonly { readonly column: number; readonly row: number }[];
}
export interface RecordedTable {
  readonly name: string;
  readonly ids: readonly string[];
  readonly fields: readonly RecordedField[];
}
export interface NetworkPlan {
  readonly columns: readonly string[];
  readonly tables: readonly RecordedTable[];
  /** Dense Float32 fields and their Float64 coordinates, including missing cells. */
  readonly bytesPerFrame: number;
  readonly fixedBytes: number;
}

/** Built once per requested recording, then cloned to the worker with the feed. */
export function networkPlan(channels: readonly Channel[]): NetworkPlan {
  const tables = new Map<string, { ids: string[]; rows: Map<string, number>; fields: Map<string, { column: number; row: number }[]> }>();
  channels.forEach((channel, column) => {
    const name = recordingTable({ ...channel.element, ...channel.class ? { class: channel.class } : {} });
    let table = tables.get(name);
    if (!table) tables.set(name, table = { ids: [], rows: new Map(), fields: new Map() });
    let row = table.rows.get(channel.element.id);
    if (row === undefined) { row = table.ids.length; table.rows.set(channel.element.id, row); table.ids.push(channel.element.id); }
    let entries = table.fields.get(channel.output);
    if (!entries) table.fields.set(channel.output, entries = []);
    entries.push({ column, row });
  });
  const planned = [...tables].map(([name, { ids, fields }]) => ({ name, ids, fields: [...fields].map(([name, entries]) => ({ name, entries })) }));
  return {
    columns: channels.map(channel => channel.column), tables: planned,
    bytesPerFrame: planned.reduce((bytes, table) => bytes + table.fields.length * (8 + 4 * table.ids.length), 0),
    fixedBytes: planned.reduce((bytes, table) => bytes + table.ids.reduce((size, id) => size + 2 * id.length + 16, 0) + 16 * table.ids.length * table.fields.length, 0),
  };
}

/** Reserve room for page metadata and the bounded update being staged beside the published recording. */
export function recordingStride(plan: NetworkPlan, rows: number, budget: number): number {
  const capacity = Math.floor((budget * 0.8 - plan.fixedBytes) / plan.bytesPerFrame);
  if (capacity < 1) throw new RangeError('The selected recording exceeds the memory budget. Select fewer outputs.');
  return Math.max(1, Math.ceil(rows / capacity));
}
