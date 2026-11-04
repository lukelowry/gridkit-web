import { recognize } from '../domain/views.js';

export type NumericConstraint = 'nonnegative';

export function numericConstraint(option: string): NumericConstraint | undefined {
  if (option === 'radius' || option === 'width') return 'nonnegative';
}

export function numericIssue(value: unknown, constraint?: NumericConstraint, field?: (name: string) => readonly unknown[]): string | null {
  if (!constraint || value == null) return null;
  const valid = (value: number) => Number.isFinite(value) && value >= 0;
  const requirement = 'at least 0';
  if (typeof value === 'number') return valid(value) ? null : `Output value must be ${requirement}.`;
  const preset = recognize(value);
  if (preset.kind === 'units') return numericIssue(preset.value, constraint, field);
  if (preset.kind === 'scale' && Array.isArray(preset.range)) return preset.range.every(value => typeof value === 'number' && valid(value)) ? null : `Output range must be ${requirement}.`;
  if (preset.kind === 'field' && field?.(preset.field).some(value => typeof value === 'number' && !valid(value))) return `Field values must be ${requirement}. Use an output range instead.`;
  return null;
}
