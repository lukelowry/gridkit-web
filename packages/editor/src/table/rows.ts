import { collectionLabel, type Entry } from '../domain/entries.js';
import { targetKey, type FieldInfo } from '@gridkit/library';
import type { TableSource, TableSort, TableColumn } from '../ui/table.js';

export const columns = [
  { key: 'class', label: 'Class', width: 156 },
  { key: 'name', label: 'Name', width: 220 },
];
export const entryColumns = [columns[1]!];
export interface EntryChoices<T extends Entry = Entry> {
  readonly byId: ReadonlyMap<string, T>;
  readonly source: TableSource;
}
/** Shared by pickers; build once for each version of their available entries. */
export function entryChoices<T extends Entry>(entries: readonly T[]): EntryChoices<T> {
  return { byId: new Map(entries.map(entry => [entry.id, entry])), source: tableSource(entries, entryColumns) };
}
const fieldGroups = { ports: 'Connections', params: 'Parameters', init: 'Initial values' } as const;

export const classKey = targetKey;
export function classesOf(entries: readonly Entry[]) {
  const groups = new Map<string, { entry: Entry; count: number }>();
  const names = new Map<string, number>();
  for (const entry of entries) {
    const key = classKey(entry), group = groups.get(key);
    if (group) group.count++;
    else {
      groups.set(key, { entry, count: 1 });
      names.set(entry.class, (names.get(entry.class) ?? 0) + 1);
    }
  }
  return [...groups].map(([key, { entry, count }]) => ({ key, label: entry.class, count,
    collection: entry.collection,
    display: names.get(entry.class)! > 1 ? `${entry.class} (${collectionLabel[entry.collection]})` : entry.class,
  })).sort((a, b) => a.label.localeCompare(b.label));
}

export function columnsOf(entries: readonly Entry[], key: string, metadata: readonly FieldInfo[]): readonly TableColumn[] {
  if (!key) return columns;
  return [
    ...(entries.some(entry => entry.name) ? [columns[1]!] : []),
    ...Object.entries(fieldGroups).flatMap(([prefix, group]) => metadata
      .filter(field => field.id.startsWith(`${prefix}.`)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(field => ({ key: field.id, label: field.id.slice(prefix.length + 1), group, width: 136,
        numeric: field.kind === 'number' || field.kind === 'reference',
        precision: field.kind === 'number' ? 6 : undefined,
      }))),
  ];
}

const searchText = new WeakMap<Entry, string>();
const searchable = (row: Entry) => {
  let text = searchText.get(row);
  if (text === undefined) searchText.set(row, text = `${row.label} ${row.name} ${row.class}`.toLocaleLowerCase());
  return text;
};

/** The rows a table shows: searched, sorted, and located on demand, so a new version of the entries costs nothing until read. */
export function tableSource(entries: readonly Entry[], shown: readonly TableColumn[] = columns): TableSource {
  const cell = (row: Entry, key: string): unknown => key === 'name' ? row.name : key === 'class' ? row.class : key === 'id' ? row.label : row.fields[key];
  const display = (value: unknown) => value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const collator = new Intl.Collator(undefined, { numeric: true });
  let previous = '';
  let rows = entries;
  let positions: Map<string, number> | undefined;
  function matching(query: string, sort: TableSort | null) {
    const normalized = query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const key = JSON.stringify([normalized, sort]);
    if (key !== previous) {
      const words = normalized.split(' ');
      rows = normalized ? entries.filter(row => words.every(word => searchable(row).includes(word))) : entries;
      if (sort) {
        const field = sort.column === null ? 'id' : shown[sort.column]?.key ?? 'id';
        rows = [...rows].sort((a, b) => {
          const av = cell(a, field), bv = cell(b, field);
          return (typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(display(av), display(bv))) * (sort.dir === 'asc' ? 1 : -1);
        });
      }
      previous = key;
      positions = undefined;
    }
    return rows;
  }
  return {
    window(query, sort, offset, limit) {
      const found = matching(query, sort);
      return {
        total: found.length,
        rows: found.slice(offset, offset + limit).map(row => ({
          key: row.id, label: row.label, cells: shown.map(column => display(cell(row, column.key))),
        })),
      };
    },
    locate(index, query, sort) {
      const found = matching(query, sort);
      positions ??= new Map(found.map((row, position) => [row.id, position]));
      return positions.get(index) ?? null;
    },
  };
}
