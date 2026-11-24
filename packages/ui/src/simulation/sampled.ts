import { untrack } from 'svelte';
import { field, type Expr, type ExprInput } from 'latkit';
import { record, targetKey, type CaseDocument, type ElementTarget, type FieldInfo, type SavedViews } from '@gridkit/library';
import { defaultMarks, type MarkDefinition } from '../domain/views.js';
import { mapFieldReads, mapOptionExpressions, optionReads } from '../domain/expressions.js';
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

export function sampledFields(mark: MarkDefinition): SampledField[] {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(mark.options)) for (const id of optionReads(key, value).fields) {
    const name = sampledName(id);
    if (name) names.add(name);
  }
  return [...names].map(field => ({ ...mark.target, field }));
}

/**
 * The outputs the network's mappings read, of the elements each reads them of: a run records them beside what it always does, so
 * a mapping of any output its elements' models have draws once a run has it.
 */
export function mappedOutputs(document: CaseDocument, userDefaults: SavedViews, caseOverrides: SavedViews): WantedOutput[] {
  const { marks } = resolveMappings(defaultMarks(document.targets), userDefaults.network, caseOverrides.network, simulationFields(document), true);
  const wanted = new Map<string, WantedOutput>();
  for (const mark of marks) for (const { field, ...target } of sampledFields(mark)) {
    const want: WantedOutput = { ...target, output: measureOf(field).output };
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

/**
 * A sampled option, or `fallback` until its samples are installed and wherever they are missing, so a missing radius never
 * hides a good color or elevation. A sampled scale or colormap without a domain holds still as time moves: a deviation across its
 * symmetric band, so no change stays the middle of the map, anything else over every recorded value.
 */
export function simulationOption(value: unknown, available: boolean | ReadonlySet<string>, target: ElementTarget, fallback: ExprInput, property?: string): unknown {
  return mapOptionExpressions(value, property ?? '', (expr, slot, nested) => {
    let first: string | undefined, missing = false;
    let mapped = mapFieldReads(expr, (id, original) => {
      const name = sampledName(id);
      if (!name || record(original)?.of != null) return original;
      first ??= name;
      if (!available || available !== true && !available.has(measureOf(name).output)) missing = true;
      if (missing) return original;
      const read = sampledExpression(name, target);
      return (record(original)?.step === true ? read.step() : read).toJSON();
    });
    if (!first) return expr;
    const base = !nested ? fallback : slot === 'visible' ? false : slot === 'text' ? '' : slot === 'color' ? null : 0;
    if (missing) return base;
    const node = record(mapped);
    if (node && ('scale' in node || 'colormap' in node) && record(node.colormap)?.kind !== 'categorical' && node.domain === undefined) {
      const measure = measureOf(first), band = measure.basis === 'value' ? null : defaultBand(measure);
      mapped = { ...node, domain: band ? [-band, band] : 'all' };
    }
    return { fallback: [mapped, base] };
  });
}
