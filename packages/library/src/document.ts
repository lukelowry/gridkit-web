import * as z from 'zod';
import {
  busSchema, deviceSchema, signalSchema, collections, freeze, freezeJson,
  type Bus, type Case, type CaseValue, type Collection, type Details, type ElementRef, type Signal, type JsonObject,
} from './case.js';
import { elementCatalog, elementValues, parameterIssues, portCollection } from './catalog.js';
import { connectionPlan, signalOutputs, portsOf, readPorts, writePorts, type PortRef, type ConnectionEnd } from './connections.js';
import { equal, FieldIndex, record, type ElementTarget } from './fields.js';

/** How a document's readers hear it change: each read tracks, each change notifies. The editor gives Svelte's; without one, nothing listens. */
export interface Tracker { track(): void; notify(): void }
const untracked: Tracker = { track() {}, notify() {} };

/** The case's saved views, as the editor wrote them: its network view's mappings, which only the editor reads. */
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
  /** Storage order only. Never an element's identity. Slots survive undo/redo. */
  readonly slot: number;
}
export type CaseInfo = Pick<Case, 'header' | 'params'>;
export interface ElementChange { readonly before: ElementRecord | null; readonly after: ElementRecord | null }
export interface ChangeSet {
  readonly elements: readonly ElementChange[];
  readonly info: { readonly before: CaseInfo; readonly after: CaseInfo } | null;
  readonly views: { readonly before: SavedViews; readonly after: SavedViews } | null;
}
export interface ElementChanges {
  name?: string;
  number?: number;
  id?: string;
  signal_id?: number;
  params?: JsonObject;
  init?: JsonObject;
  ports?: Readonly<Record<string, Connection>>;
}
export interface Transaction {
  add(model: string, params?: JsonObject): ElementRef;
  addBus(value: Pick<Bus, 'class' | 'name' | 'params'> & { number?: number; readonly [key: string]: unknown }): ElementRef<'buses'>;
  addDevice(value: Pick<ConnectedDevice, 'class' | 'ports' | 'params'> & { id?: string; readonly [key: string]: unknown }): ElementRef<'devices'>;
  addSignal(value: Signal): ElementRef<'signals'>;
  update(ref: ElementRef, changes: ElementChanges): void;
  connect(from: PortRef, to: ConnectionEnd): void;
  disconnect(port: PortRef): void;
  remove(refs: readonly ElementRef[], options?: { connected: 'reject' | 'cascade' }): void;
  details(value: Details): void;
  /** Replaces the case's saved views. */
  views(next: SavedViews): void;
}

export class ElementValidationError extends Error {
  constructor(readonly field: string, message: string) { super(message); }
}

const referenceSchema = z.object({ collection: z.enum(['buses', 'devices', 'signals']), id: z.string().min(1) });
// Persist only supported editor coordinates.
const placementSchema = z.object({ network: z.tuple([z.number(), z.number()]).optional() });
// Read only what the editor uses; fields an editor adds later pass through unread.
const metadataSchema = z.object({
  id: z.string().min(1),
  placement: placementSchema.default({}),
  ports: z.record(z.string(), referenceSchema).optional(),
});

const nativeId = (collection: Collection, value: Elements[Collection]): string | number =>
  collection === 'buses' ? (value as Bus).number : collection === 'signals' ? (value as Signal).signal_id : (value as ConnectedDevice).id;

/** Canonical case data. Mutations are staged, validated, then applied as one change set. */
export class CaseDocument {
  #elements = new Map<string, ElementRecord>();
  #order: Record<Collection, string[]> = { buses: [], devices: [], signals: [] };
  #identifiers: Record<Collection, Map<string | number, Set<string>>> = {
    buses: new Map(), devices: new Map(), signals: new Map(),
  };
  #incoming = new Map<string, Set<string>>();
  #info: CaseInfo;
  #extra: Readonly<Record<string, unknown>>;
  #hasSignals: boolean;
  #editing = false;
  #suggestions = new Map<string, number>();
  #fields = new FieldIndex();
  #views: SavedViews;
  #numbering = 0;
  #wiring = 0;
  // What readers read again on, each only when its part changed: a scene waits on how the case is built, not on its values.
  readonly #content: Tracker;
  readonly #schema: Tracker;
  readonly #built: Tracker;
  readonly #numbered: Tracker;
  readonly #described: Tracker;
  readonly #drawn: Tracker;

  constructor(input: Case, tracker: () => Tracker = () => untracked) {
    this.#content = tracker(); this.#schema = tracker(); this.#built = tracker();
    this.#numbered = tracker(); this.#described = tracker(); this.#drawn = tracker();
    // A Case comes from parseCase/createCase or an immutable export. Share its validated data; edits replace touched rows.
    const source = freeze(input);
    const { header, params, buses, devices, signals, ...extra } = source;
    this.#extra = extra;
    this.#views = freeze(readSavedViews(record(extra.$editor)?.views));
    this.#hasSignals = signals !== undefined;
    this.#info = freeze({ header: source.header, params: source.params });
    const savedPorts = new Map<string, Readonly<Record<string, ElementRef>>>();
    const used = new Set<string>();
    for (const collection of collections) {
      for (const value of source[collection] ?? []) {
        const saved = value.$editor;
        const meta = saved === undefined ? undefined : metadataSchema.parse(saved);
        const id = meta?.id ?? crypto.randomUUID();
        if (used.has(id)) throw new Error(`Duplicate editor identity: ${id}.`);
        used.add(id);
        const ref = freeze({ collection, id });
        const { $editor: _metadata, ...original } = value;
        let payload = original;
        const placement: Partial<Record<Space, Position>> = Object.fromEntries(Object.entries(meta?.placement ?? {}).filter(([, point]) => point !== undefined));
        const extension = record(payload.extension);
        const x = extension?.longitude, y = extension?.latitude;
        if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90) {
          placement.geographic = [x, y];
          const { longitude: _x, latitude: _y, ...rest } = extension!;
          payload = { ...payload, extension: rest };
        }
        if (placement.geographic && payload.extension !== undefined && !record(payload.extension)) throw new Error('Geographic editor placement requires an object extension.');
        const element: ElementRecord = freeze({ ref, value: payload as Elements[Collection], placement, slot: this.#order[collection].length });
        this.#elements.set(id, element);
        this.#order[collection].push(id);
        this.#indexIdentifier(element, true);
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
      this.#indexConnections(next, true);
    }
    for (const element of this.#elements.values()) this.#fields.replace(null, element);
  }

  get views(): SavedViews { this.#drawn.track(); return this.#views; }
  /** Changes whenever a bus or signal is added, removed, or renumbered: what shows connections by number reads them again. */
  get numbering(): number { this.#numbered.track(); return this.#numbering; }
  /** Changes whenever an element is added or removed, or connects differently: what reads how the case is built reads it again. */
  get wiring(): number { this.#built.track(); return this.#wiring; }
  /** Changes when field kinds, presence, or class membership change, independently of field values. */
  get schema(): number { this.#schema.track(); return this.#fields.version; }
  get targets(): readonly ElementTarget[] { this.#schema.track(); return this.#fields.targets(); }
  fields(target: ElementTarget) { this.#schema.track(); return this.#fields.fields(target); }
  get info(): CaseInfo { this.#described.track(); return this.#info; }
  get size(): number { this.#content.track(); return this.#elements.size; }
  get<C extends Collection>(ref: ElementRef<C>): ElementRecord<C> | undefined {
    this.#content.track();
    const row = this.#elements.get(ref.id);
    return row?.ref.collection === ref.collection ? row as ElementRecord<C> : undefined;
  }
  rows<C extends Collection>(collection: C): readonly ElementRecord<C>[] {
    this.#content.track();
    const rows: ElementRecord<C>[] = [];
    for (const id of this.#order[collection]) {
      const row = this.#elements.get(id);
      if (row) rows.push(row as ElementRecord<C>);
    }
    return rows;
  }
  find<C extends Collection>(collection: C, identifier: string | number): ElementRef<C> | undefined {
    this.#content.track();
    const ids = this.#identifiers[collection].get(identifier);
    if (ids?.size !== 1) return undefined;
    return this.#elements.get(ids.values().next().value!)!.ref as ElementRef<C>;
  }
  identifierTaken(collection: Collection, identifier: string | number, except?: ElementRef): boolean {
    const ids = this.#identifiers[collection].get(identifier);
    return !!ids && (ids.size > 1 || !except || !ids.has(except.id));
  }
  suggestIdentifier(collection: Collection, prefix = ''): string | number {
    const key = `${collection}:${prefix}`;
    const [value, next] = this.#free(collection, prefix, this.#suggestions.get(key), value => this.#identifiers[collection].has(value));
    this.#suggestions.set(key, next);
    return value;
  }
  /** The first native identifier of `collection` from `next` that is not `taken`, a device's named for `prefix`, and its number. */
  #free(collection: Collection, prefix: string, next = collection === 'signals' ? 0 : 1, taken: (value: string | number) => boolean): [string | number, number] {
    const value = () => collection === 'devices' ? `${prefix.toLowerCase()}-${next}` : next;
    while (taken(value())) next++;
    return [value(), next];
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
  connection(kind: string, port: string, number: number): Connection {
    const collection = portCollection(kind, port);
    if (!collection) return number;
    const ref = this.find(collection, number);
    if (!ref) throw new Error(`Connection ${port} needs an existing, unambiguous ${collection === 'buses' ? 'bus' : 'signal'}.`);
    return ref;
  }

  canConnect(from: PortRef, to: ConnectionEnd, replaces?: PortRef): boolean {
    try {
      const read = (ref: ElementRef): ElementRecord | undefined => {
        const row = this.get(ref);
        if (!row || row.ref.id !== replaces?.element.id) return row;
        const ports = { ...portsOf(row) };
        delete ports[replaces.port];
        return { ...row, value: { ...row.value, ports } };
      };
      const plan = connectionPlan(from, to, read);
      if (plan.target?.collection !== 'signals') return true;
      const outputs = signalOutputs(this.dependents(plan.target).map(ref => read(ref)!), plan.target);
      const proposed = plan.ports.filter(end => elementCatalog.get(String(this.get(end.element)?.value.class))?.ports[end.port]?.output);
      return new Set([...outputs, ...proposed].map(end => `${end.element.id}:${end.port}`)).size <= 1;
    } catch { return false; }
  }

  edit(build: (tx: Transaction) => void): ChangeSet | null {
    if (this.#editing) throw new Error('Nested transactions are not supported.');
    this.#editing = true;
    const staged = new Map<string, ElementRecord | null>();
    const incoming = new Map<string, Set<string>>();
    const identifiers: Record<Collection, Map<string | number, Set<string>>> = { buses: new Map(), devices: new Map(), signals: new Map() };
    const hints = new Map<string, number>();
    let info = this.#info;
    let views = this.#views;
    let active = true;
    const assertActive = () => { if (!active) throw new Error('This transaction has finished.'); };
    const get = (ref: ElementRef) => {
      assertActive();
      const row = staged.has(ref.id) ? staged.get(ref.id) : this.get(ref);
      if (!row || row.ref.collection !== ref.collection) throw new Error('This element no longer exists.');
      return row;
    };
    const stage = (id: string, row: ElementRecord | null) => {
      const previous = staged.get(id);
      if (previous) {
        this.#indexConnections(previous, false, incoming);
        identifiers[previous.ref.collection].get(nativeId(previous.ref.collection, previous.value))?.delete(id);
      }
      staged.set(id, row);
      if (row) {
        this.#indexConnections(row, true, incoming);
        const index = identifiers[row.ref.collection], key = nativeId(row.ref.collection, row.value);
        const ids = index.get(key) ?? new Set<string>();
        ids.add(id); index.set(key, ids);
      }
    };
    const allocate = (collection: Collection, prefix = '') => {
      assertActive();
      const key = `${collection}:${prefix}`;
      // Taken by a staged row, or by a committed one the transaction has not changed.
      const [value, next] = this.#free(collection, prefix, hints.get(key) ?? this.#suggestions.get(key), value => !!identifiers[collection].get(value)?.size
        || [...this.#identifiers[collection].get(value) ?? []].some(id => {
          const row = staged.has(id) ? staged.get(id) : this.#elements.get(id);
          return !!row && nativeId(collection, row.value) === value;
        }));
      hints.set(key, next + 1);
      return value;
    };
    const put = (row: ElementRecord) => { assertActive(); stage(row.ref.id, freeze(row)); };
    const add = <C extends Collection>(collection: C, value: unknown): ElementRef<C> => {
      assertActive();
      const ref: ElementRef<C> = freeze({ collection, id: crypto.randomUUID() });
      put({ ref, value: this.#validate(collection, value), placement: {}, slot: -1 });
      return ref;
    };
    const tx: Transaction = {
      add: (model, params) => {
        const value = elementValues(model, params);
        const collection = elementCatalog.get(model)!.collection;
        return collection === 'buses'
          ? tx.addBus({ ...value, name: '' }) : tx.addDevice({ ...value, ports: {} });
      },
      addBus: value => add('buses', { ...value, number: value.number ?? allocate('buses') as number }),
      addDevice: value => add('devices', { ...value, id: value.id ?? allocate('devices', value.class) as string }),
      addSignal: value => add('signals', value),
      update: (ref, changes) => {
        const row = get(ref);
        // The editable surface is explicit; identity, class, and opaque extras cannot be overwritten.
        const allowed = ref.collection === 'buses' ? ['name', 'number', 'params', 'init', 'ports']
          : ref.collection === 'signals' ? ['name', 'signal_id'] : ['name', 'id', 'params', 'init', 'ports'];
        for (const key of Object.keys(changes)) if (!allowed.includes(key)) throw new Error(`Cannot edit ${key} on ${ref.collection}.`);
        const value = this.#validate(ref.collection, { ...row.value, ...changes });
        put({ ...row, value });
      },
      connect: (from, to) => {
        const plan = connectionPlan(from, to, get);
        const target = plan.target ?? tx.addSignal({ signal_id: allocate('signals') as number, name: '' });
        for (const end of plan.ports) {
          tx.update(end.element, { ports: { ...portsOf(get(end.element)), [end.port]: target } });
        }
      },
      disconnect: ({ element, port }) => {
        const row = get(element);
        if (element.collection === 'signals') throw new Error('Signals do not own ports.');
        const ports = { ...portsOf(row) };
        delete ports[port];
        tx.update(element, { ports });
      },
      remove: (refs, options = { connected: 'reject' }) => {
        const pending = [...refs];
        const visited = new Set<string>();
        while (pending.length) {
          const ref = pending.pop()!;
          if (visited.has(ref.id)) continue;
          visited.add(ref.id);
          get(ref);
          stage(ref.id, null);
          if (options.connected === 'cascade') {
            const candidates = new Set([...(this.#incoming.get(ref.id) ?? []), ...(incoming.get(ref.id) ?? [])]);
            for (const id of candidates) {
              const row = staged.has(id) ? staged.get(id) : this.#elements.get(id);
              if (row && Object.values(portsOf(row))
                .some(port => typeof port !== 'number' && port.id === ref.id)) pending.push(row.ref);
            }
          }
        }
      },
      details: next => {
        assertActive();
        const checked = z.object({
          case_name: z.string(), case_description: z.string(), case_comments: z.string(),
          freq_base: z.number(), va_base: z.number(),
        }).parse(next);
        const { freq_base, va_base, ...header } = checked;
        info = freeze({ header: { ...info.header, ...header }, params: { ...info.params, freq_base, va_base } });
      },
      views: next => { assertActive(); views = freezeJson(readSavedViews(next)); },
    };
    try {
      const result: unknown = build(tx);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw new Error('Transactions must be synchronous.');
      }
      const elements: ElementChange[] = [];
      const offsets: Record<Collection, number> = { buses: 0, devices: 0, signals: 0 };
      for (const [id, candidate] of staged) {
        const before = this.#elements.get(id) ?? null;
        let after = candidate;
        if (equal(before, after)) continue;
        if (after && after.slot < 0) {
          const collection = after.ref.collection;
          after = freeze({ ...after, slot: this.#order[collection].length + offsets[collection]++ });
        }
        elements.push({ before, after });
      }
      this.#validateChanges(staged, elements);
      const changedInfo = equal(this.#info, info) ? null : { before: this.#info, after: info };
      const changedViews = equal(this.#views, views) ? null : { before: this.#views, after: views };
      if (!elements.length && !changedInfo && !changedViews) return null;
      const changes = freeze({ elements, info: changedInfo, views: changedViews });
      this.apply(changes);
      for (const [key, next] of hints) this.#suggestions.set(key, next);
      return changes;
    } finally { active = false; this.#editing = false; }
  }

  /** Applies already validated history records; no callbacks run between writes. */
  apply(changes: ChangeSet, direction: 'forward' | 'backward' = 'forward'): void {
    const [schema, wiring, numbering] = [this.#fields.version, this.#wiring, this.#numbering];
    const previous = direction === 'forward' ? 'before' : 'after';
    const next = direction === 'forward' ? 'after' : 'before';
    for (const change of changes.elements) if (change[previous]) {
      this.#indexIdentifier(change[previous], false);
      this.#indexConnections(change[previous], false);
    }
    for (const change of changes.elements) {
      const row = change[next], old = change[previous], collection = (row ?? old)!.ref.collection;
      if (collection !== 'devices' && (!row || !old || nativeId(collection, row.value) !== nativeId(collection, old.value))) this.#numbering++;
      if (!row || !old || !equal(portsOf(row), portsOf(old))) this.#wiring++;
      this.#fields.replace(old, row);
      if (row) {
        this.#elements.set(row.ref.id, row);
        this.#order[row.ref.collection][row.slot] = row.ref.id;
        this.#indexIdentifier(row, true);
        this.#indexConnections(row, true);
      } else if (old) this.#elements.delete(old.ref.id);
    }
    if (changes.info) this.#info = changes.info[next];
    if (changes.views) this.#views = changes.views[next];
    if (changes.elements.length) this.#content.notify();
    if (schema !== this.#fields.version) this.#schema.notify();
    if (wiring !== this.#wiring) this.#built.notify();
    if (numbering !== this.#numbering) this.#numbered.notify();
    if (changes.info) this.#described.notify();
    if (changes.views) this.#drawn.notify();
  }

  export(): Case {
    const rows = <C extends Collection>(collection: C) => this.rows(collection).map(row => {
      const ports = portsOf(row);
      const references = Object.fromEntries(Object.entries(ports).filter(([, value]) => typeof value !== 'number'));
      const extension = record(row.value.extension);
      const { geographic, ...placement } = row.placement;
      // This validated row keeps its collection when editor references become native port numbers.
      const native = writePorts(row, connection => this.number(connection)) as NonNullable<CaseValue[C]>[number];
      const value = {
        ...native,
        $editor: {
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
      ...(Object.keys(this.#views).length || record(record(this.#extra.$editor)?.views)
        ? { $editor: { ...record(this.#extra.$editor), views: this.#views } } : {}),
      ...(this.#hasSignals || this.rows('signals').length ? { signals: rows('signals') } : {}),
    };
    // Rows and metadata were validated on import or edit; exporting only restores their native representation.
    return freeze(value) as Case;
  }

  #validate<C extends Collection>(collection: C, input: unknown): Elements[C] {
    if (collection === 'signals') return freezeJson(signalSchema.parse(input)) as Elements[C];
    const raw = record(input)!;
    const ports = z.record(z.string(), z.union([referenceSchema, z.int()])).parse(raw.ports ?? {});
    const native = (collection === 'buses' ? busSchema : deviceSchema).parse({ ...raw, ports: Object.fromEntries(Object.keys(ports).map(name => [name, 0])) });
    return freezeJson({ ...native, ports }) as Elements[C];
  }
  #validateChanges(staged: Map<string, ElementRecord | null>, changes: readonly ElementChange[]): void {
    const final = (id: string) => staged.has(id) ? staged.get(id) : this.#elements.get(id);
    const changedIds: Record<Collection, Map<string | number, string>> = { buses: new Map(), devices: new Map(), signals: new Map() };
    for (const { before, after } of changes) {
      if (!after) continue;
      const { collection, id } = after.ref;
      const identifier = nativeId(collection, after.value);
      if (!before || nativeId(collection, before.value) !== identifier) {
        const others = this.#identifiers[collection].get(identifier) ?? [];
        if ([...others].some(other => other !== id && final(other) && nativeId(collection, final(other)!.value) === identifier)
          || changedIds[collection].has(identifier)) throw new ElementValidationError('identifier', `Duplicate ${collection} identifier: ${identifier}.`);
        if (typeof identifier === 'number' && identifier < 0) throw new ElementValidationError('identifier', 'Identifiers must be nonnegative.');
        if (typeof identifier === 'string' && !identifier.trim()) throw new ElementValidationError('identifier', 'Enter a device ID.');
        changedIds[collection].set(identifier, id);
      }
      if (collection === 'signals') continue;
      const oldPorts = before ? portsOf(before) : {};
      for (const [port, connection] of Object.entries(portsOf(after))) {
        const expected = portCollection(String(after.value.class), port);
        if (typeof connection === 'number') {
          if (expected && (!before || !equal(oldPorts[port], connection))) throw new ElementValidationError(`ports.${port}`, `Connection ${port} must reference an existing ${expected === 'buses' ? 'bus' : 'signal'}.`);
          continue;
        }
        const target = final(connection.id);
        if (!target || target.ref.collection !== connection.collection || connection.collection === 'devices'
          || (expected && expected !== connection.collection)) throw new ElementValidationError(`ports.${port}`, `Invalid target for connection ${port}.`);
      }
      this.#validateParameters(before, after);
    }
    const signals = new Set<string>();
    for (const { before, after } of changes) {
      if (!after || after.ref.collection === 'signals') continue;
      const ports = portsOf(after);
      const previous = before ? portsOf(before) : {};
      for (const [port, target] of Object.entries(ports)) if (typeof target !== 'number' && target.collection === 'signals' && !equal(previous[port], target)) signals.add(target.id);
    }
    for (const id of signals) {
      const candidates = new Set([...(this.#incoming.get(id) ?? []), ...staged.keys()]);
      const rows = [...candidates].map(final).filter((row): row is ElementRecord => !!row);
      if (signalOutputs(rows, { collection: 'signals', id }).length > 1) throw new ElementValidationError('ports', 'A signal can have only one output.');
    }
    for (const { before, after } of changes) if (before && !after) {
      for (const id of this.#incoming.get(before.ref.id) ?? []) {
        const row = final(id);
        if (row && Object.values(portsOf(row)).some(port => typeof port !== 'number' && port.id === before.ref.id)) {
          throw new Error('This element is connected. Remove or reconnect the connected elements first, or explicitly cascade the deletion.');
        }
      }
    }
  }
  #validateParameters(before: ElementRecord | null, after: ElementRecord): void {
    const definition = elementCatalog.get(String(after.value.class));
    if (definition?.collection !== after.ref.collection) return;
    for (const group of ['params', 'init'] as const) {
      const value = record(after.value[group]);
      if (!value) continue;
      const issue = parameterIssues(definition[group], value as JsonObject, before ? (record(before.value[group]) ?? {}) as JsonObject : undefined)[0];
      if (issue) throw new ElementValidationError(`${group}.${String(issue.path[0])}`, issue.message);
    }
  }
  #indexIdentifier(row: ElementRecord, add: boolean): void {
    const index = this.#identifiers[row.ref.collection], key = nativeId(row.ref.collection, row.value);
    if (add) {
      const ids = index.get(key) ?? new Set<string>(); ids.add(row.ref.id); index.set(key, ids);
    } else {
      const ids = index.get(key); ids?.delete(row.ref.id); if (!ids?.size) index.delete(key);
    }
  }
  #indexConnections(row: ElementRecord, add: boolean, index = this.#incoming): void {
    for (const port of Object.values(portsOf(row))) {
      if (typeof port === 'number') continue;
      if (add) {
        const ids = index.get(port.id) ?? new Set<string>(); ids.add(row.ref.id); index.set(port.id, ids);
      } else {
        const ids = index.get(port.id); ids?.delete(row.ref.id); if (!ids?.size) index.delete(port.id);
      }
    }
  }
}
