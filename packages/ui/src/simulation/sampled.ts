import { untrack } from 'svelte';
import { field, type Expr, type ExprInput } from 'latkit';
import { record, targetKey, type CaseDocument, type ElementTarget, type FieldInfo, type SavedViews } from '@gridkit/library';
import { defaultMarks, mapFieldReads, fieldsIn } from '../domain/views.js';
import { resolveMappings } from '../mappings/resolve.js';
import { outputLabel } from './channels.js';
import { recordableOutputs, type Channel, type WantedOutput } from '@gridkit/library/gridkit';
import { defaultBand, measureOf, referenceField } from '../domain/measure.js';
import { recordingTable } from './recording-plan.js';

export const simulationDataset = 'simulation';
/** A sampled field the network reads, of the elements `target` names: `Vm` or `Vm~change`. */
export interface SampledField extends ElementTarget { readonly field: string }
export const matchesField = (channel: Channel, sampled: SampledField) => channel.element.collection === sampled.collection &&
  (!sampled.class || channel.class === sampled.class) && channel.output === measureOf(sampled.field).output;
/** The sampled field `id` names, without its `simulation.`, or `null` for any other field. */
export const sampledName = (id: string) => id.startsWith('simulation.') ? id.slice('simulation.'.length) : null;

type FieldLookup = (target: ElementTarget) => readonly FieldInfo[];
const fieldLookups = new WeakMap<CaseDocument, FieldLookup>();

/**
 * A case's fields beside every output a run of it can record, the same before, during, and after one. A mapping can name any of
 * them at any time, and a run records what the mappings name (`mappedOutputs`); a basis belongs to the field that names it, not
 * to this list.
 */
export function simulationFields(document: CaseDocument): FieldLookup {
  const kept = fieldLookups.get(document);
  if (kept) return kept;
  const known = new Map<string, readonly FieldInfo[]>();
  const scanned = new Set<string>();
  const recorded = new Map<string, Map<string, { unit?: string | undefined; present: number }>>();
  const lookup: FieldLookup = target => {
    const key = targetKey(target);
    let fields = known.get(key);
    if (fields) return fields;
    const own = document.fields(target), total = own.reduce((n, field) => Math.max(n, field.presence.total), 0);
    // Build collection and class counts together, once for this immutable document.
    if (target.collection !== 'signals' && !scanned.has(target.collection)) untrack(() => {
      scanned.add(target.collection);
      for (const row of document.rows(target.collection)) {
        const keys = [targetKey({ collection: target.collection }), targetKey({ collection: target.collection, class: String(row.value.class) })];
        for (const { id, unit } of recordableOutputs(row)) {
          for (const group of keys) {
            let outputs = recorded.get(group);
            if (!outputs) recorded.set(group, outputs = new Map());
            const output = outputs.get(id) ?? { unit, present: 0 };
            output.present++; outputs.set(id, output);
          }
        }
      }
    });
    const outputs = recorded.get(key) ?? new Map<string, { unit?: string | undefined; present: number }>();
    fields = [...own, ...[...outputs].map(([output, { unit, present }]) => ({ id: `simulation.${output}`, label: outputLabel(output), kind: 'number' as const,
      ...unit && { unit }, presence: { present, total } }))];
    known.set(key, fields);
    return fields;
  };
  fieldLookups.set(document, lookup);
  return lookup;
}

/**
 * The outputs the network's mappings read, of the elements each reads them of: a run records them beside what it always does, so
 * a mapping of any output its elements' models have draws once a run has it.
 */
export function mappedOutputs(document: CaseDocument, userDefaults: SavedViews, caseOverrides: SavedViews): WantedOutput[] {
  const { marks } = resolveMappings(defaultMarks(document.targets), userDefaults.network, caseOverrides.network, simulationFields(document), true);
  const wanted = new Map<string, WantedOutput>();
  for (const mark of marks) for (const name of fieldsIn(mark.options).flatMap(id => sampledName(id) ?? [])) {
    const want: WantedOutput = { ...mark.target, output: measureOf(name).output };
    wanted.set(JSON.stringify([want.collection, want.class ?? null, want.output]), want);
  }
  return [...wanted.values()];
}

/**
 * What sampled field `name` reads of `target`'s elements: an output as recorded, or its deviation from the value the recording
 * keeps beside it at the reference, as `affine` reads it for the plot. A zero reference has no percent: dividing by 0 is missing.
 */
export function sampledExpression(name: string, target: ElementTarget): Expr {
  const { output, basis } = measureOf(name), table = [simulationDataset, recordingTable(target)] as const;
  const value = field(output).from(table);
  if (basis === 'value') return value;
  const from = field(referenceField(output)).from(table), change = value.sub(from);
  return basis === 'change' ? change : change.mul(100).div(from.abs());
}

/** Translate the UI's field names to what the recording holds. The case's static data never changes. */
export function simulationExpression(value: unknown, available: boolean, target: ElementTarget = { collection: 'buses' }): unknown {
  return mapFieldReads(value, (name, original) => {
    const field = sampledName(name);
    if (!field) return original;
    if (!available) return null;
    const read = sampledExpression(field, target);
    return (record(original)?.step === true ? read.step() : read).toJSON();
  });
}

/**
 * A sampled option, or `fallback` until its samples are installed and wherever they are missing, so a missing radius never
 * hides a good color or elevation. A sampled scale or colormap without a domain holds still as time moves: a deviation across its
 * symmetric band, so no change stays the middle of the map, anything else over every recorded value.
 */
export function simulationOption(value: unknown, available: boolean | ReadonlySet<string>, target: ElementTarget, fallback: ExprInput, property?: string): unknown {
  if (property === 'legend') return value;
  const signals = fieldsIn(value).flatMap(name => sampledName(name) ?? []);
  if (!signals.length) return value;
  const apply = (child: unknown, key: string, missing: ExprInput = 0) => simulationOption(child, available, target, missing, key);
  const node = record(value);
  if (Array.isArray(value) && ['markers', 'offset', 'position', 'size', 'blend', 'slices', 'inputs'].includes(property ?? ''))
    return value.map(child => apply(child, property === 'markers' ? 'strokeMarker' : 'component'));
  if (node && (property === 'strokeMarker' || property === 'marker' || property === 'label' && 'text' in node ||
      ['symbol', 'icon', 'gauge', 'pie', 'wgsl'].includes(property ?? '') || 'units' in node)) {
    return Object.fromEntries(Object.entries(node).map(([key, child]) => {
      if (['paths', 'images', 'colors', 'source', 'font'].includes(key)) return [key, child];
      const missing = key === 'visible' ? false : key === 'text' ? '' : key === 'color' ? null : 0;
      return [key, apply(child, key, missing)];
    }));
  }
  // The catalog may advertise an output before its samples arrive; arrival changes this option's expression. Every measure of an
  // output reads what the recording holds of it.
  if (!available || (typeof available !== 'boolean' && signals.some(name => !available.has(measureOf(name).output)))) return fallback;
  const measure = measureOf(signals[0]!);
  const band = measure.basis === 'value' ? null : defaultBand(measure);
  const mapped = node && ('colormap' in node || 'scale' in node) && record(node.colormap)?.kind !== 'categorical' && node.domain === undefined ? { ...node, domain: band ? [-band, band] : 'all' } : value;
  return { fallback: [simulationExpression(mapped, true, target), fallback] };
}
