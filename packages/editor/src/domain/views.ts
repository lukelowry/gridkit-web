import type { Edges, Vertices, Scene, Theme } from 'latkit';
import {
  elementCatalog, readSavedViews, record,
  type ElementTarget, type SavedViews,
} from '@gridkit/library';

/**
 * How a case draws its network. Mark options remain opaque until resolved, so later options survive export.
 */
export interface MarkOptions { vertices: Vertices; edges: Edges }
export type MarkKind = keyof MarkOptions;
const structuralOptions = ['vertices', 'edges', 'name', 'ends', 'ports', 'contains', 'joins', 'drag', 'pick', 'select'] as const;
export type Properties<K extends MarkKind> = Partial<Omit<MarkOptions[K], typeof structuralOptions[number]>>;
export type MarkDefinition = { [K in MarkKind]: {
  readonly id: string; readonly target: ElementTarget; readonly kind: K; readonly options: Properties<K>;
} }[MarkKind];
export interface ViewConfig {
  readonly space?: Scene['space'];
  readonly theme?: Exclude<Theme, string>;
  readonly marks?: readonly MarkDefinition[];
}
export interface MarkRef { readonly mark: string }
export type MappingOptions = Properties<'vertices'> & Properties<'edges'>;
export interface Diagnostic { readonly path: string; readonly message: string; readonly code: 'invalid' | 'unsupported' | 'missing-field' }

/** The catalog owns each mark's table, ends, and ports; latkit validates everything else when a view shows it. */
export function optionIssue(option: string): string | null {
  return (structuralOptions as readonly string[]).includes(option) ? `${option} is structural and cannot be mapped.` : null;
}
export function optionValue(option: string, value: unknown): unknown {
  const issue = optionIssue(option);
  if (issue) throw new Error(issue);
  const data = json(value);
  if ((option === 'position' || option === 'size') && data !== null && !(Array.isArray(data) && data.length === 2)) throw new Error(`Map ${option} as a pair.`);
  return data;
}
/** Convert latkit builders via toJSON and own the resulting data; unlike case rows, these may be class instances. */
export function json<T>(value: T): T {
  const encoded = JSON.stringify(value, (_key, child: unknown) => {
    if (typeof child === 'number' && !Number.isFinite(child)) throw new Error('Mappings require finite numbers.');
    if (child === undefined || typeof child === 'function' || typeof child === 'bigint') throw new Error('Mappings must be JSON.');
    return child;
  });
  if (encoded === undefined) throw new Error('Mappings must be JSON.');
  return JSON.parse(encoded) as T;
}
/** Fields read locally by native expressions; joins and literal text arguments are not local fields. */
export function fieldsIn(value: unknown): readonly string[] {
  const fields = new Set<string>();
  function visit(node: unknown) {
    if (typeof node === 'string' && node.startsWith('$')) fields.add(node.slice(1));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (record(node)) {
      const expression = record(node)!;
      if (typeof expression.field === 'string') {
        if (expression.from == null) fields.add(expression.field);
        return;
      }
      for (const [key, child] of Object.entries(expression)) {
        if ((key === 'is' || key === 'contains') && Array.isArray(child)) visit(child[0]);
        else if (!['colormap', 'font', 'from'].includes(key)) visit(child);
      }
    }
  }
  visit(value);
  return [...fields];
}
function localField(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('$')) return value.slice(1);
  const node = record(value);
  return node && Object.keys(node).length === 1 && typeof node.field === 'string' ? node.field : null;
}
export function recognize(value: unknown) {
  const node = record(value);
  const only = (...keys: string[]) => !!node && Object.keys(node).every(key => keys.includes(key));
  const field = localField(value);
  if (field !== null) return { kind: 'field' as const, field };
  const input = localField(node?.value);
  if (input !== null) {
    if (node?.scale && only('scale', 'value', 'domain')) return { kind: 'scale' as const, field: input, range: node.scale, domain: node.domain };
    if (node?.colormap && only('colormap', 'value', 'domain')) return { kind: 'colormap' as const, field: input, colormap: node.colormap, domain: node.domain };
  }
  if (node?.units !== undefined && only('units', 'atLeast', 'atMost')) return { kind: 'units' as const, value: node.units, atLeast: node.atLeast, atMost: node.atMost };
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return { kind: 'constant' as const, value };
  return { kind: 'expression' as const, value };
}
export function readMark(value: unknown): MarkDefinition | null {
  const mark = record(value), target = record(mark?.target);
  if (!mark || typeof mark.id !== 'string' || !mark.id || !target || !['buses', 'devices', 'signals'].includes(String(target.collection))
    || (target.class !== undefined && typeof target.class !== 'string') || !['vertices', 'edges'].includes(String(mark.kind)) || !record(mark.options)) return null;
  return mark as unknown as MarkDefinition;
}

/** Theme groups inherit independently, just as options inherit within each group in latkit. */
export function mergeTheme(base: Exclude<Theme, string>, override: Exclude<Theme, string>): Exclude<Theme, string> {
  function merge(before: unknown, after: unknown): unknown {
    const group = record(after);
    if (!group || Object.hasOwn(group, 'units') || Object.hasOwn(group, 'px')) return after;
    const result: Record<string, unknown> = { ...record(before) };
    for (const [key, value] of Object.entries(group)) result[key] = merge(result[key], value);
    return result;
  }
  return merge(base, override) as Exclude<Theme, string>;
}

/** Edits to `saved` views, each validated as it is made; the views keep the catalog's marks until one is edited. */
export function mappingDraft(saved: SavedViews, defaults: () => readonly MarkDefinition[]) {
  let value = readSavedViews(saved);
  function viewData() {
    const data = value.network;
    if (data !== undefined && !record(data)) throw new Error('This view has unreadable mappings. Reset the view before editing it.');
    return record(data) ?? {};
  }
  function marks(): unknown[] {
    const list = viewData().marks;
    if (list !== undefined && !Array.isArray(list)) throw new Error('This view has an unreadable mark list.');
    return list ? [...list as unknown[]] : defaults().map(mark => ({ ...mark, options: {} }));
  }
  function update(target: MarkRef, option: string, next: unknown, reset: boolean) {
    const list = marks(), index = list.findIndex(mark => readMark(mark)?.id === target.mark);
    const mark = readMark(list[index]);
    if (!mark) throw new Error(`Unknown mark: ${target.mark}.`);
    const options = { ...mark.options } as Record<string, unknown>;
    if (reset && !Object.hasOwn(options, option)) return;
    if (reset) delete options[option];
    else options[option] = optionValue(option, next);
    list[index] = { ...mark, options };
    value = { network: { ...viewData(), marks: list } };
  }
  return {
    get value(): SavedViews { return value; },
    map<K extends keyof MappingOptions>(target: MarkRef, option: K, next: Exclude<MappingOptions[K], undefined>) { update(target, option, next, false); },
    reset(target: MarkRef, option: keyof MappingOptions) { update(target, option, undefined, true); },
    view(patch: Omit<ViewConfig, 'marks'>) {
      const data = json(patch);
      if (data.theme !== undefined && !record(data.theme)) throw new Error('Invalid theme.');
      value = { network: { ...viewData(), ...data } };
    },
    resetView() { value = {}; },
  };
}
export type MappingTransaction = Omit<ReturnType<typeof mappingDraft>, 'value'>;

/** How the network draws an element: a bus as a marker, a model with two bus ends as an edge between them. */
export interface Representation {
  readonly vertices?: Pick<Vertices, 'contains'>;
  readonly edges?: Pick<Edges, 'ends' | 'joins'>;
}
export function representation(target: ElementTarget): Representation | undefined {
  if (target.collection === 'buses') return { vertices: {} };
  if (target.collection === 'signals') return undefined;
  const ends = elementCatalog.get(target.class ?? '')?.model.ends;
  return ends ? { edges: { ends: ends.map(name => `ports.${name}`) as [string, string] } } : undefined;
}

/** The marks that draw `targets` until a view lists its own: lines, each other edge model, then buses on top. */
export function defaultMarks(targets: readonly ElementTarget[] = []): MarkDefinition[] {
  const classes = new Map<string, ElementTarget>([['Branch', { collection: 'devices', class: 'Branch' }]]);
  for (const target of targets) if (target.collection === 'devices')
    classes.set(target.class!, target);
  const marks: MarkDefinition[] = [];
  for (const target of classes.values()) {
    const rep = representation(target);
    const id = target.class === 'Branch' ? 'branches' : `${target.collection}:${target.class}`;
    if (rep?.edges) marks.push({ id, target, kind: 'edges', options: {} });
    if (rep?.vertices) marks.push({ id, target, kind: 'vertices', options: {} });
  }
  marks.push({ id: 'buses', target: { collection: 'buses' }, kind: 'vertices', options: {} });
  return marks;
}
