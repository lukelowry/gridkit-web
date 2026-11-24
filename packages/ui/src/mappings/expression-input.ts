import type { ExprInput } from 'latkit';

export type InputKind = 'formula' | 'index' | 'fraction' | 'size' | 'offset' | 'color' | 'visible';
export type InputIssue = (key: string, message?: string) => void;

export function parseInput(input: string, kind: InputKind): ExprInput | undefined {
  const raw = input.trim();
  if (!raw && kind !== 'formula') return undefined;
  let value: ExprInput;
  try { value = JSON.parse(raw); }
  catch {
    if (kind !== 'formula' && (raw.startsWith('$') && raw.length > 1 || kind === 'color' && CSS.supports('color', raw))) return raw;
    throw new Error(kind === 'formula' ? 'Enter a latkit expression as JSON.' : 'Enter a value, a $field, or a JSON expression.');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Enter a finite number.');
    if (kind === 'fraction' && (value < 0 || value > 1)) throw new Error('Use a fraction from 0 to 1.');
    if (kind === 'size' && value < 0) throw new Error('Enter a nonnegative size.');
  }
  return value;
}
