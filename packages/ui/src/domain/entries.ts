import { collections, elementFields, type CaseDocument, type ConnectedDevice, type ElementRecord, type ElementRef } from '@gridkit/library';

/** An element as people find it: its native number or id, its name and class, and its fields with connections by number. */
export interface Entry extends ElementRef {
  readonly label: string;
  readonly name: string;
  readonly class: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export const collectionLabel = { buses: 'Buses', devices: 'Devices', signals: 'Signals' };

// A document and its elements never change, so each entry is built once.
const built = new WeakMap<ElementRecord, Entry>();
/** `row` as an entry, built once per imported element. */
export function entryOf(document: CaseDocument, row: ElementRecord): Entry {
  const cached = built.get(row), { ref, value } = row;
  if (cached) return cached;
  const fields = elementFields(row);
  if (ref.collection === 'devices') for (const [key, connection] of Object.entries((value as ConnectedDevice).ports)) {
    fields[`ports.${key}`] = document.number(connection);
  }
  const entry = { ...ref,
    label: String(ref.collection === 'buses' ? value.number : ref.collection === 'devices' ? value.id : value.signal_id),
    name: typeof value.name === 'string' ? value.name : '',
    class: ref.collection === 'signals' ? 'Signal' : String(value.class), fields,
  };
  built.set(row, entry);
  return entry;
}
export const entriesOf = (document: CaseDocument): readonly Entry[] => collections.flatMap(collection => document.rows(collection).map(row => entryOf(document, row)));

export function sameReference(a: ElementRef | null, b: ElementRef | null): boolean {
  return a === b || (a !== null && b !== null && a.collection === b.collection && a.id === b.id);
}
