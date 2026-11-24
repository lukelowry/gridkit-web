import { record } from '@gridkit/library';

function array(items: unknown[], transform: (item: unknown, index: number) => unknown): unknown[] {
  let result: unknown[] | undefined;
  items.forEach((item, i) => {
    const next = transform(item, i);
    if (next !== item) (result ??= items.slice())[i] = next;
  });
  return result ?? items;
}

type ReadField = (name: string, original: unknown) => unknown;

export function mapFieldReads(value: unknown, visit: ReadField): unknown {
  function walk(node: unknown): unknown {
    if (typeof node === 'string' && node.startsWith('$')) return visit(node.slice(1), node);
    if (Array.isArray(node)) return array(node, walk);
    const expr = record(node);
    if (!expr) return node;
    if (typeof expr.field === 'string') {
      if (typeof expr.of === 'string') { visit(expr.of, node); return node; }
      return expr.from == null ? visit(expr.field, node) : node;
    }
    let result: Record<string, unknown> | undefined;
    for (const [key, child] of Object.entries(expr)) {
      if (key === 'colormap' || key === 'domain' || key === 'scale') continue;
      let next: unknown;
      if ((key === 'is' || key === 'contains') && Array.isArray(child))
        next = array(child, (item, i) => i === 0 ? walk(item) : item);
      else if (key === 'cases' && 'match' in expr && Array.isArray(child))
        next = array(child, pair => Array.isArray(pair) ? array(pair, (item, i) => i === 1 ? walk(item) : item) : pair);
      else next = walk(child);
      if (next !== child) (result ??= { ...expr })[key] = next;
    }
    return result ?? node;
  }
  return walk(value);
}

// A compound option contains independent expressions. Each keeps its own missing-value fallback.
const children: Readonly<Record<string, readonly string[]>> = {
  label: ['text', 'place', 'offset', 'color'],
  strokeMarker: ['marker', 'at', 'offset', 'size', 'color', 'visible'],
  marker: ['symbol', 'icon', 'gauge', 'pie', 'wgsl'],
  symbol: ['index'], icon: ['index'], gauge: ['fill'], pie: ['slices'], wgsl: ['inputs'], shade: ['inputs'],
};
const sequences = new Set(['markers', 'offset', 'position', 'size', 'blend', 'slices', 'inputs']);
const literalOptions = new Set(['legend', 'route', 'meet', 'geometry', 'bends', 'poles']);
export function mapOptionExpressions(value: unknown, property: string, visit: (expr: unknown, slot: string, nested: boolean) => unknown): unknown {
  function walk(node: unknown, key: string, nested: boolean): unknown {
    if (literalOptions.has(key)) return node;
    if (Array.isArray(node) && sequences.has(key))
      return array(node, item => walk(item, key === 'markers' ? 'strokeMarker' : 'component', true));
    const object = record(node);
    if (object) {
      const keys = 'units' in object ? ['units'] : Object.hasOwn(children, key) && (key !== 'label' || 'text' in object) ? children[key] : undefined;
      if (keys) {
        let next: Record<string, unknown> | undefined;
        for (const child of keys) {
          if (!Object.hasOwn(object, child)) continue;
          const result = walk(object[child], child, true);
          if (result !== object[child]) (next ??= { ...object })[child] = result;
        }
        return next ?? node;
      }
    }
    if (key === 'marker' || key === 'strokeMarker') return node;
    return visit(node, key, nested);
  }
  return walk(value, property, false);
}

export function optionReads(property: string, value: unknown) {
  const fields = new Set<string>();
  let issue: string | undefined, sampledRoot = false;
  mapOptionExpressions(value, property, (expr, _, nested) => mapFieldReads(expr, (name, original) => {
    fields.add(name);
    if (!nested && name.startsWith('simulation.')) sampledRoot = true;
    const node = record(original);
    if (node?.of != null && typeof node.field === 'string' && node.field.startsWith('simulation.'))
      issue = 'Map simulation fields on their own elements; simulation joins cannot also read through a reference.';
    return original;
  }));
  return { fields, sampledRoot, issue };
}
