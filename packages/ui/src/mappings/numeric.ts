import { elementFields, targetKey, type CaseDocument, type ElementTarget } from '@gridkit/library';
import { tables, tableOf } from '../rendering/data.js';
import { recognize } from '../domain/views.js';

const minima = new WeakMap<CaseDocument, Map<string, number>>();
export function fieldMinimum(document: CaseDocument, target: ElementTarget, name: string): number {
  let cached = minima.get(document);
  if (!cached) minima.set(document, cached = new Map());
  const key = JSON.stringify([targetKey(target), name]);
  const known = cached.get(key);
  if (known !== undefined) return known;
  let minimum = Infinity;
  for (const row of document.rows(target.collection)) {
    if (target.class && row.value.class !== target.class) continue;
    const value = elementFields(row)[name];
    if (typeof value === 'number') minimum = Math.min(minimum, value);
  }
  cached.set(key, minimum);
  return minimum;
}
export type NumericConstraint = 'nonnegative';

export function numericConstraint(option: string): NumericConstraint | undefined {
  if (option === 'radius' || option === 'width') return 'nonnegative';
}

export function numericIssue(value: unknown, constraint?: NumericConstraint, field?: (name: string) => number): string | null {
  if (!constraint || value == null) return null;
  const valid = (value: number) => Number.isFinite(value) && value >= 0;
  const requirement = 'at least 0';
  if (typeof value === 'number') return valid(value) ? null : `Output value must be ${requirement}.`;
  const preset = recognize(value);
  if (preset.kind === 'units') return numericIssue(preset.value, constraint, field);
  if (preset.kind === 'scale' && Array.isArray(preset.range)) return preset.range.every(value => typeof value === 'number' && valid(value)) ? null : `Output range must be ${requirement}.`;
  if (preset.kind === 'field' && field && !(field(preset.field) >= 0)) return `Field values must be ${requirement}. Use an output range instead.`;
  return null;
}

export function categoryExamples(document: CaseDocument, target: ElementTarget, field: string): (string | number)[] {
  const values = new Set<string | number>();
  const table = tableOf(target);
  const rows = table ? tables(document).get(table) ?? [] : document.rows(target.collection);
  let inspected = 0;
  for (const row of rows) {
    if (target.class && row.value.class !== target.class) continue;
    if (++inspected > 512) break;
    const value = elementFields(row)[field];
    if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) values.add(value);
    if (values.size === 8) break;
  }
  return [...values];
}
