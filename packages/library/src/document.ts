import * as z from 'zod';
import { collections, freeze, freezeJson, type Bus, type Case, type CaseValue, type Collection, type ElementRef, type Signal, type JsonObject } from './case.js';
import { portCollection } from './catalog.js';
import { portsOf, readPorts, writePorts } from './connections.js';
import { FieldIndex, record, type ElementTarget } from './fields.js';

/** The case's saved views, as the UI wrote them: its network view's mappings, which only the UI reads. */
export interface SavedViews { readonly network?: unknown }
/** Keeps the supported view namespace without discarding opaque options inside it. */
export function readSavedViews(input: unknown): SavedViews {
  const saved = record(input);
  return saved && Object.hasOwn(saved, 'network') ? { network: saved.network } : {};
}

export type Connection = ElementRef | number;
export interface ConnectedDevice {
  readonly class: string;
  readonly id: string;
  readonly ports: Readonly<Record<string, Connection>>;
  readonly params: JsonObject;
  readonly [key: string]: unknown;
}
export type ConnectedBus = Bus & { readonly ports: Readonly<Record<string, Connection>> };
export interface Elements { buses: ConnectedBus; devices: ConnectedDevice; signals: Signal }
export type Position = readonly [number, number];
export type Space = 'network' | 'geographic';
export type Placement = Readonly<Partial<Record<Space, Position>>>;
export interface ElementRecord<C extends Collection = Collection> {
  readonly ref: ElementRef<C>;
  readonly value: Elements[C];
  readonly placement: Placement;
}
export type CaseInfo = Pick<Case, 'header' | 'params'>;
const referenceSchema = z.object({ collection: z.enum(['buses', 'devices', 'signals']), id: z.string().min(1) });
// Persist only supported UI coordinates.
const placementSchema = z.object({ network: z.tuple([z.number(), z.number()]).optional() });
// Read only what the UI uses; fields a later UI adds pass through unread.
const metadataSchema = z.object({
  id: z.string().min(1),
  placement: placementSchema.default({}),
  ports: z.record(z.string(), referenceSchema).optional(),
});

const nativeId = (collection: Collection, value: Elements[Collection]): string | number =>
  collection === 'buses' ? (value as Bus).number : collection === 'signals' ? (value as Signal).signal_id : (value as ConnectedDevice).id;

/** An immutable imported case and the indexes used to inspect, render, and simulate it. */
export class CaseDocument {
  #elements = new Map<string, ElementRecord>();
  #order: Record<Collection, string[]> = { buses: [], devices: [], signals: [] };
  #identifiers: Record<Collection, Map<string | number, Set<string>>> = {
    buses: new Map(), devices: new Map(), signals: new Map(),
  };
  #incoming = new Map<string, Set<string>>();
  readonly #info: CaseInfo;
  readonly #extra: Readonly<Record<string, unknown>>;
  readonly #hasSignals: boolean;
  readonly #fields: FieldIndex;
  readonly #views: SavedViews;

  constructor(input: Case) {
    // A Case comes from parseCase/createCase or an immutable export. Share its validated data without exposing mutation operations.
    const source = freezeJson(input);
    const { header, params, buses, devices, signals, ...extra } = source;
    this.#extra = extra;
    this.#views = freeze(readSavedViews(record(extra.$ui)?.views));
    this.#hasSignals = signals !== undefined;
    this.#info = freeze({ header: source.header, params: source.params });
    const savedPorts = new Map<string, Readonly<Record<string, ElementRef>>>();
    const used = new Set<string>();
    for (const collection of collections) {
      for (const value of source[collection] ?? []) {
        const saved = value.$ui;
        const meta = saved === undefined ? undefined : metadataSchema.parse(saved);
        const id = meta?.id ?? crypto.randomUUID();
        if (used.has(id)) throw new Error(`Duplicate identity: ${id}.`);
        used.add(id);
        const ref = freeze({ collection, id });
        const { $ui: _metadata, ...original } = value;
        let payload = original;
        const placement: Partial<Record<Space, Position>> = Object.fromEntries(Object.entries(meta?.placement ?? {}).filter(([, point]) => point !== undefined));
        const extension = record(payload.extension);
        const x = extension?.longitude, y = extension?.latitude;
        if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90) {
          placement.geographic = [x, y];
          const { longitude: _x, latitude: _y, ...rest } = extension!;
          payload = { ...payload, extension: rest };
        }
        if (placement.geographic && payload.extension !== undefined && !record(payload.extension)) throw new Error('Geographic placement requires an object extension.');
        const element: ElementRecord = freeze({ ref, value: payload as Elements[Collection], placement });
        this.#elements.set(id, element);
        this.#order[collection].push(id);
        this.#indexIdentifier(element);
        if (meta?.ports) savedPorts.set(id, meta.ports);
      }
    }
    for (const collection of ['buses', 'devices'] as const) for (const row of this.rows(collection)) {
      const payload = readPorts(row.value);
      const ports = Object.fromEntries(Object.entries(payload.ports).map(([port, number]) => {
        const saved = savedPorts.get(row.ref.id)?.[port];
        const target = saved && this.get(saved);
        const kind = portCollection(row.value.class, port);
        // Reject stale metadata after an external edit; preserve unresolved/native values.
        const restored = target && (!kind || target.ref.collection === kind)
          && nativeId(target.ref.collection, target.value) === number ? target.ref : undefined;
        const resolved = kind ? this.find(kind, number as number) : undefined;
        return [port, restored ?? resolved ?? number];
      }));
      const next = freeze({ ...row, value: { ...payload, ports } } as ElementRecord);
      this.#elements.set(row.ref.id, next);
      this.#indexConnections(next);
    }
    this.#fields = new FieldIndex(this.#elements.values());
  }

  get views(): SavedViews { return this.#views; }
  get targets(): readonly ElementTarget[] { return this.#fields.targets(); }
  fields(target: ElementTarget) { return this.#fields.fields(target); }
  get info(): CaseInfo { return this.#info; }
  get size(): number { return this.#elements.size; }
  get<C extends Collection>(ref: ElementRef<C>): ElementRecord<C> | undefined {
    const row = this.#elements.get(ref.id);
    return row?.ref.collection === ref.collection ? row as ElementRecord<C> : undefined;
  }
  rows<C extends Collection>(collection: C): readonly ElementRecord<C>[] {
    const rows: ElementRecord<C>[] = [];
    for (const id of this.#order[collection]) {
      const row = this.#elements.get(id);
      if (row) rows.push(row as ElementRecord<C>);
    }
    return rows;
  }
  find<C extends Collection>(collection: C, identifier: string | number): ElementRef<C> | undefined {
    const ids = this.#identifiers[collection].get(identifier);
    if (ids?.size !== 1) return undefined;
    return this.#elements.get(ids.values().next().value!)!.ref as ElementRef<C>;
  }
  identifierTaken(collection: Collection, identifier: string | number, except?: ElementRef): boolean {
    const ids = this.#identifiers[collection].get(identifier);
    return !!ids && (ids.size > 1 || !except || !ids.has(except.id));
  }
  /** Uses the incoming-reference index; cost is proportional to this element's connections. */
  dependents(ref: ElementRef): readonly ElementRef[] {
    if (!this.get(ref)) return [];
    return [...(this.#incoming.get(ref.id) ?? [])].map(id => this.#elements.get(id)!.ref);
  }
  /** Human-facing/file representation of a connection, never used as internal identity. */
  number(connection: Connection): number {
    if (typeof connection === 'number') return connection;
    const target = this.get(connection);
    if (!target) throw new Error('A connection targets a missing element.');
    const value = nativeId(target.ref.collection, target.value);
    if (typeof value !== 'number') throw new Error('Connections must target a bus or signal.');
    return value;
  }
  export(): Case {
    const rows = <C extends Collection>(collection: C) => this.rows(collection).map(row => {
      const ports = portsOf(row);
      const references = Object.fromEntries(Object.entries(ports).filter(([, value]) => typeof value !== 'number'));
      const extension = record(row.value.extension);
      const { geographic, ...placement } = row.placement;
      // This validated row keeps its collection when UI references become native port numbers.
      const native = writePorts(row, connection => this.number(connection)) as NonNullable<CaseValue[C]>[number];
      const value = {
        ...native,
        $ui: {
          id: row.ref.id,
          ...(Object.keys(placement).length ? { placement } : {}),
          ...(Object.keys(references).length ? { ports: references } : {}),
        },
      };
      // Geographic placement is the case's own data, unlike network placement.
      if (geographic) Object.assign(value, { extension: { ...extension,
        longitude: geographic[0], latitude: geographic[1],
      } });
      return value;
    });
    const value: CaseValue = { ...this.#extra, ...this.#info, buses: rows('buses'), devices: rows('devices'),
      ...(Object.keys(this.#views).length || record(record(this.#extra.$ui)?.views)
        ? { $ui: { ...record(this.#extra.$ui), views: this.#views } } : {}),
      ...(this.#hasSignals || this.rows('signals').length ? { signals: rows('signals') } : {}),
    };
    // Rows and metadata were validated on import; exporting only restores their native representation.
    return freeze(value) as Case;
  }

  #indexIdentifier(row: ElementRecord): void {
    const index = this.#identifiers[row.ref.collection], key = nativeId(row.ref.collection, row.value);
    const ids = index.get(key) ?? new Set<string>();
    ids.add(row.ref.id); index.set(key, ids);
  }
  #indexConnections(row: ElementRecord): void {
    for (const port of Object.values(portsOf(row))) {
      if (typeof port === 'number') continue;
      const ids = this.#incoming.get(port.id) ?? new Set<string>();
      ids.add(row.ref.id); this.#incoming.set(port.id, ids);
    }
  }
}
