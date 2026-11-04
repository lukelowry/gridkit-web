import * as z from 'zod';
import type { Collection } from './case.js';
import type { ElementRecord } from './document.js';
import { elementCatalog } from './catalog.js';

export interface ElementTarget { readonly collection: Collection; readonly class?: string }
/** What a field holds: a number, a flag, text, or a connection to another element. */
export type FieldKind = 'number' | 'bool' | 'text' | 'reference';
export interface FieldInfo {
  readonly id: string;
  readonly label: string;
  readonly kind: FieldKind | null;
  readonly unit?: string;
  readonly choices?: readonly string[];
  readonly semantic?: 'longitude' | 'latitude';
  readonly presence: { readonly present: number; readonly total: number };
}
const targetKeys = new Map<Collection, Map<string | undefined, string>>();
/** A target's key, written once per collection and class: tables and indexes key every row by it. */
export function targetKey({ collection, class: kind }: ElementTarget): string {
  const keys = targetKeys.get(collection) ?? targetKeys.set(collection, new Map()).get(collection)!;
  let key = keys.get(kind);
  if (key === undefined) keys.set(kind, key = JSON.stringify([collection, kind ?? null]));
  return key;
}
export const targetOf = (row: ElementRecord): ElementTarget => ({ collection: row.ref.collection,
  class: row.ref.collection === 'signals' ? 'Signal' : String(row.value.class) });
export const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** Whether two JSON values are the same. */
export const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function fieldGroup(id: string) {
  if (id.startsWith('simulation.')) return 'Simulation';
  if (id.startsWith('params.')) return 'Parameters';
  if (id.startsWith('init.')) return 'Initial values';
  if (id.startsWith('placement.') || id.startsWith('ports.') || id === 'uuid') return null;
  return 'Identity';
}

/** A bus's name and number, as titles, tags, and announcements name it; a bus named only by its number reads as one. */
export function busName(row: ElementRecord): string {
  const name = typeof row.value.name === 'string' ? row.value.name.trim() : '';
  return name && name !== String(row.value.number) ? `${name} (${row.value.number})` : `Bus ${row.value.number}`;
}

/** Canonical field paths. Reading values is separate from discovering metadata. */
export function elementFields(row: ElementRecord): Record<string, unknown> {
  const result: Record<string, unknown> = { uuid: row.ref.id, ...Object.fromEntries(
    ['number', 'id', 'signal_id', 'class', 'name'].filter(key => row.value[key] !== undefined).map(key => [key, row.value[key]])),
  };
  if (row.ref.collection === 'buses') {
    const model = elementCatalog.get(String(row.value.class))?.label;
    result.displayLabel = `${busName(row)}${model && row.value.class !== 'Bus' ? `\n${model}` : ''}`;
  }
  for (const group of ['ports', 'params', 'init']) {
    for (const [key, value] of Object.entries(record(row.value[group]) ?? {})) result[`${group}.${key}`] = value;
  }
  for (const [space, point] of Object.entries(row.placement)) if (point) {
    const axes = space === 'geographic' ? ['longitude', 'latitude'] : ['x', 'y'];
    axes.forEach((axis, index) => { result[`placement.${space}.${axis}`] = point[index]; });
  }
  return result;
}
const valueKind = (id: string, value: unknown): FieldKind | null => id.startsWith('ports.') ? 'reference'
  : typeof value === 'number' && Number.isFinite(value) ? 'number'
  : typeof value === 'string' ? 'text' : typeof value === 'boolean' ? 'bool' : null;
type Metadata = Omit<FieldInfo, 'presence'>;
function declared(target: ElementTarget): Metadata[] {
  const definition = elementCatalog.get(target.class ?? '');
  const result: Metadata[] = [
    { id: 'uuid', label: 'Editor identity', kind: 'text' }, { id: 'name', label: 'Name', kind: 'text' },
    { id: 'class', label: 'Class', kind: 'text' },
    { id: target.collection === 'buses' ? 'number' : target.collection === 'signals' ? 'signal_id' : 'id',
      label: target.collection === 'buses' ? 'Bus number' : 'ID', kind: target.collection === 'devices' ? 'text' : 'number' },
  ];
  if (target.collection === 'buses') result.push({ id: 'displayLabel', label: 'Display label', kind: 'text' });
  for (const space of ['network', 'geographic']) {
    for (const axis of space === 'geographic' ? ['longitude', 'latitude'] as const : ['x', 'y'] as const) {
      result.push({ id: `placement.${space}.${axis}`, label: `${space} ${axis}`, kind: 'number',
        ...(axis === 'longitude' || axis === 'latitude' ? { semantic: axis, unit: '°' } : {}) });
    }
  }
  if (definition?.collection === target.collection) {
    for (const [key, port] of Object.entries(definition.ports)) result.push({ id: `ports.${key}`, label: port.label, kind: 'reference' });
    for (const group of ['params', 'init'] as const) {
      for (const [key, field] of Object.entries(definition[group]?.shape ?? {}) as [string, z.ZodType][]) {
        const meta = field.meta();
        const schema = z.toJSONSchema(field, { unrepresentable: 'any' });
        result.push({ id: `${group}.${key}`, label: meta?.title ?? key,
          kind: schema.type === 'number' || schema.type === 'integer' ? 'number' : schema.type === 'string' ? 'text' : schema.type === 'boolean' ? 'bool' : null,
          ...(typeof meta?.unit === 'string' ? { unit: meta.unit } : {}),
          ...(Array.isArray(meta?.choices) ? { choices: meta.choices as string[] } : {}) });
      }
    }
  }
  return result;
}
interface Counts { target: ElementTarget; total: number; fields: Map<string, Map<FieldKind | null, number>>; cache?: readonly FieldInfo[] }
/** One initial scan; thereafter work is proportional to the fields in changed elements. */
export class FieldIndex {
  #groups = new Map<string, Counts>();
  #collections = new Map<Collection, readonly FieldInfo[]>();
  #targets: readonly ElementTarget[] | undefined;
  #version = 0;
  get version(): number { return this.#version; }
  replace(before: ElementRecord | null, after: ElementRecord | null) {
    const was = before && elementFields(before), now = after && elementFields(after);
    if (before && after && targetKey(targetOf(before)) === targetKey(targetOf(after)) && was && now
      && Object.keys(was).length === Object.keys(now).length
      && Object.keys(was).every(id => Object.hasOwn(now, id) && valueKind(id, was[id]) === valueKind(id, now[id]))) return;
    if (before && was) this.#change(before, -1, was);
    if (after && now) this.#change(after, 1, now);
    this.#targets = undefined;
    this.#version++;
  }
  targets(): readonly ElementTarget[] { return this.#targets ??= [...this.#groups.values()].filter(group => group.total).map(group => group.target); }
  fields(target: ElementTarget): readonly FieldInfo[] {
    if (target.class === undefined) {
      const cached = this.#collections.get(target.collection);
      if (cached) return cached;
      const groups = [...this.#groups.values()].filter(group => group.target.collection === target.collection && group.total);
      const total = groups.reduce((sum, group) => sum + group.total, 0);
      if (!groups.length) {
        const fields = declared({ ...target, class: target.collection === 'buses' ? 'Bus' : 'Signal' }).map(field => ({ ...field, presence: { present: 0, total: 0 } }));
        this.#collections.set(target.collection, fields);
        return fields;
      }
      const merged = new Map<string, FieldInfo>();
      for (const group of groups) for (const field of this.fields(group.target)) {
        const previous = merged.get(field.id);
        merged.set(field.id, { ...field, kind: previous && previous.kind !== field.kind ? null : field.kind,
          presence: { present: (previous?.presence.present ?? 0) + field.presence.present, total } });
      }
      const fields = [...merged.values()];
      this.#collections.set(target.collection, fields);
      return fields;
    }
    const group = this.#groups.get(targetKey(target));
    if (group?.cache) return group.cache;
    const metadata = new Map(declared(target).map(field => [field.id, field]));
    for (const id of group?.fields.keys() ?? []) if (!metadata.has(id)) metadata.set(id, { id, label: id.slice(id.indexOf('.') + 1), kind: null });
    const fields = [...metadata.values()].map(field => {
      const counts = group?.fields.get(field.id);
      const present = [...counts?.values() ?? []].reduce((sum, count) => sum + count, 0);
      const kinds = [...counts?.keys() ?? []];
      return Object.freeze({ ...field, kind: kinds.length > 1 ? null : kinds.length === 1 ? kinds[0]! : field.kind,
        presence: Object.freeze({ present, total: group?.total ?? 0 }) });
    });
    if (group) group.cache = fields;
    return fields;
  }
  #change(row: ElementRecord, direction: 1 | -1, fields: Record<string, unknown>) {
    const target = targetOf(row), key = targetKey(target);
    this.#collections.delete(target.collection);
    let group = this.#groups.get(key);
    if (!group) { group = { target, total: 0, fields: new Map() }; this.#groups.set(key, group); }
    group.total += direction; delete group.cache;
    for (const [id, value] of Object.entries(fields)) {
      const kind = valueKind(id, value), counts = group.fields.get(id) ?? new Map();
      const count = (counts.get(kind) ?? 0) + direction;
      if (count) counts.set(kind, count); else counts.delete(kind);
      if (counts.size) group.fields.set(id, counts); else group.fields.delete(id);
    }
  }
}
