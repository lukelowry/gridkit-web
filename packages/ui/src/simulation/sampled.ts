import { untrack } from 'svelte';
import { field, type Expr, type ExprInput } from 'latkit';
import { record, type CaseDocument, type ElementTarget, type FieldInfo } from '@gridkit/library';
import { fieldsIn } from '../domain/views.js';
import { outputLabel } from './channels.js';
import { recordedOutputs, type Channel } from '@gridkit/library/gridkit';
import { defaultBand, measureOf, referenceField } from '../domain/measure.js';

export const simulationDataset = 'simulation';
/** A sampled field the network reads, of the elements `target` names: `Vm` or `Vm~change`. */
export interface SampledField extends ElementTarget { readonly field: string }
export const matchesField = (channel: Channel, sampled: SampledField) => channel.element.collection === sampled.collection &&
  (!sampled.class || channel.class === sampled.class) && channel.output === measureOf(sampled.field).output;
/** The sampled field `id` names, without its `simulation.`, or `null` for any other field. */
export const sampledName = (id: string) => id.startsWith('simulation.') ? id.slice('simulation.'.length) : null;

/**
 * A case's fields beside what a run of it records, the same before, during, and after one. A mapping can name them at any time;
 * a basis belongs to the field that names it, not to this list.
 */
export function simulationFields(document: CaseDocument): (target: ElementTarget) => readonly FieldInfo[] {
  const known = new Map<string, readonly FieldInfo[]>();
  return target => {
    const key = JSON.stringify([target.collection, target.class ?? null]);
    let fields = known.get(key);
    if (fields) return fields;
    const own = document.fields(target), total = own.reduce((n, field) => Math.max(n, field.presence.total), 0);
    const outputs = new Map<string, { unit?: string | undefined; present: number }>();
    // Which outputs exist depends on the case's classes, not its values: no reader should follow every edit for it.
    if (target.collection !== 'signals') untrack(() => {
      for (const row of document.rows(target.collection)) {
        if (target.class && row.value.class !== target.class) continue;
        for (const { id, unit } of recordedOutputs(row)) {
          const output = outputs.get(id) ?? { unit, present: 0 };
          output.present++; outputs.set(id, output);
        }
      }
    });
    fields = [...own, ...[...outputs].map(([output, { unit, present }]) => ({ id: `simulation.${output}`, label: outputLabel(output), kind: 'number' as const,
      ...unit && { unit }, presence: { present, total } }))];
    known.set(key, fields);
    return fields;
  };
}

/**
 * What sampled field `name` reads of `target`'s elements: an output as recorded, or its deviation from the value the recording
 * keeps beside it at the reference, as `affine` reads it for the plot. A zero reference has no percent: dividing by 0 is missing.
 */
export function sampledExpression(name: string, target: ElementTarget): Expr {
  const { output, basis } = measureOf(name), table = [simulationDataset, target.collection] as const;
  const value = field(output).from(table);
  if (basis === 'value') return value;
  const from = field(referenceField(output)).from(table), change = value.sub(from);
  return basis === 'change' ? change : change.mul(100).div(from.abs());
}

/** Translate the UI's field names to what the recording holds. The case's static data never changes. */
export function simulationExpression(value: unknown, available: boolean, target: ElementTarget = { collection: 'buses' }): unknown {
  if (typeof value === 'string' && value.startsWith('$simulation.'))
    return available ? sampledExpression(value.slice(12), target).toJSON() : null;
  if (Array.isArray(value)) return value.map(child => simulationExpression(child, available, target));
  const node = record(value);
  if (!node) return value;
  if (typeof node.field === 'string' && node.field.startsWith('simulation.')) {
    if (!available) return null;
    const read = sampledExpression(node.field.slice(11), target);
    return (node.step === true ? read.step() : read).toJSON();
  }
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, simulationExpression(child, available, target)]));
}

/**
 * A sampled option, or `fallback` until its samples are installed and wherever they are missing, so a missing radius never
 * hides a good color or elevation. A sampled scale or colormap without a domain holds still as time moves: a deviation across its
 * symmetric band, so no change stays the middle of the map, anything else over every recorded value.
 */
export function simulationOption(value: unknown, available: boolean | ReadonlySet<string>, target: ElementTarget, fallback: ExprInput): unknown {
  const signals = fieldsIn(value).flatMap(name => sampledName(name) ?? []);
  if (!signals.length) return value;
  // The catalog may advertise an output before its samples arrive; arrival changes this option's expression. Every measure of an
  // output reads what the recording holds of it.
  if (!available || (typeof available !== 'boolean' && signals.some(name => !available.has(measureOf(name).output)))) return fallback;
  const node = record(value), measure = measureOf(signals[0]!);
  const band = measure.basis === 'value' ? null : defaultBand(measure);
  const mapped = node && ('colormap' in node || 'scale' in node) && node.domain === undefined ? { ...node, domain: band ? [-band, band] : 'all' } : value;
  return { fallback: [simulationExpression(mapped, true, target), fallback] };
}
