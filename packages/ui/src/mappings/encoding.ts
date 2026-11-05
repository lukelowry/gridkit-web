import { field, type Colormap } from 'latkit';
import { recognize } from '../domain/views.js';
import { fieldGroup, record, type FieldInfo } from '@gridkit/library';
import { numericIssue, type NumericConstraint } from './numeric.js';

/** What a mark option takes: a color, a number, or a label's text. */
export type OptionControl = 'color' | 'number' | 'label';
export type Domain = [low: number, high: number] | 'all';
/**
 * A mark option as the UI reads it. Every saved value has one, and anything the UI has no controls for is a formula, its
 * latkit JSON kept as it is.
 */
export type Encoding =
  | { kind: 'inherit' }
  | { kind: 'off' }
  | { kind: 'fixed'; value: number | string }
  | { kind: 'field'; field: string; maxWidth?: number }
  | { kind: 'colormap'; field: string; colormap: Colormap; domain?: Domain }
  | { kind: 'scale'; field: string; scale: [low: number, high: number]; domain?: Domain }
  | { kind: 'formula'; node: unknown };

export function fieldCompatible(info: FieldInfo, control: OptionControl) {
  return fieldGroup(info.id) !== null && (control === 'label' ? ['text', 'number'].includes(info.kind ?? '') : info.kind === 'number');
}

const isPair = (input: unknown): input is [number, number] => Array.isArray(input) && input.length === 2 && input.every(n => typeof n === 'number');
const isDomain = (input: unknown): input is Domain | undefined => input === undefined || input === 'all' || isPair(input);
const withDomain = (domain: Domain | undefined) => domain === undefined ? {} : { domain };

export function encodingOf(node: unknown, control: OptionControl): Encoding {
  if (node === undefined) return { kind: 'inherit' };
  if (node === null) return { kind: 'off' };
  const formula: Encoding = { kind: 'formula', node };
  if (control === 'label') {
    const label = record(node);
    if (!label || Object.keys(label).some(key => !['text', 'maxWidth'].includes(key)) || (label.maxWidth !== undefined && typeof label.maxWidth !== 'number')) return formula;
    const text = recognize(label.text);
    return text.kind === 'field' ? { kind: 'field', field: text.field, ...typeof label.maxWidth === 'number' ? { maxWidth: label.maxWidth } : {} } : formula;
  }
  const preset = recognize(node);
  if (preset.kind === 'constant') return (control === 'color' ? typeof node === 'string' : typeof node === 'number') ? { kind: 'fixed', value: node as number | string } : formula;
  if (preset.kind === 'field') return control === 'number' ? { kind: 'field', field: preset.field } : formula;
  if (preset.kind === 'colormap' && control === 'color' && isDomain(preset.domain)
    && (typeof preset.colormap === 'string' || Array.isArray(record(preset.colormap)?.colors)))
    return { kind: 'colormap', field: preset.field, colormap: preset.colormap as Colormap, ...withDomain(preset.domain) };
  if (preset.kind === 'scale' && control === 'number' && isDomain(preset.domain) && isPair(preset.range))
    return { kind: 'scale', field: preset.field, scale: preset.range, ...withDomain(preset.domain) };
  return formula;
}

/** The option's latkit JSON, `undefined` to inherit; throws what is wrong with an encoding that cannot be one. */
export function nodeOf(encoding: Encoding, constraint?: NumericConstraint): unknown {
  const checked = (value: unknown) => { const issue = numericIssue(value, constraint); if (issue) throw new Error(issue); };
  const domained = (domain: Domain | undefined) => {
    if (Array.isArray(domain) && domain[0] >= domain[1]) throw new Error('Input maximum must be greater than its minimum.');
    return withDomain(domain);
  };
  switch (encoding.kind) {
    case 'inherit': return undefined;
    case 'off': return null;
    case 'formula': return encoding.node;
    case 'fixed': if (typeof encoding.value === 'number') checked(encoding.value); return encoding.value;
    case 'field': {
      const value = field(encoding.field).toJSON();
      if (encoding.maxWidth !== undefined && encoding.maxWidth <= 0) throw new Error('Label width must be greater than zero.');
      return encoding.maxWidth === undefined ? value : { text: value, maxWidth: encoding.maxWidth };
    }
    case 'colormap': return { colormap: encoding.colormap, value: field(encoding.field).toJSON(), ...domained(encoding.domain) };
    case 'scale': {
      const node = { scale: encoding.scale, value: field(encoding.field).toJSON(), ...domained(encoding.domain) };
      checked(node);
      return node;
    }
  }
}
/** A label reads a field as its text. */
export const labelNode = (encoding: Encoding, constraint?: NumericConstraint) => {
  const node = nodeOf(encoding, constraint);
  return encoding.kind === 'field' && encoding.maxWidth === undefined ? { text: node } : node;
};

/** What an option is set to, in a few words: `name` names a field. */
export function encodingSummary(encoding: Encoding, control: OptionControl, name: (field: string) => string, unset: string): string {
  switch (encoding.kind) {
    case 'inherit': return unset;
    case 'off': return control === 'color' ? 'Endpoint colors' : 'Off';
    case 'fixed': return typeof encoding.value === 'string' && encoding.value.startsWith('var(') ? 'Theme color' : String(encoding.value);
    case 'field': case 'colormap': case 'scale': return name(encoding.field);
    case 'formula': {
      // A size in position units shrinks as the view zooms out, up to its pixels.
      const size = recognize(encoding.node);
      return size.kind === 'units' ? typeof size.atMost === 'number' ? `Up to ${size.atMost}` : 'Scaled' : 'Formula';
    }
  }
}

/** What a mark's color reads and how; `null` for any color that is not a plain colormap. */
export function colorScaleOf(color: unknown) {
  const preset = recognize(color);
  if (preset.kind !== 'colormap') return null;
  const domain = Array.isArray(preset.domain) && preset.domain.length === 2 && preset.domain.every(n => typeof n === 'number') ? preset.domain as [number, number] : null;
  return { field: preset.field, map: preset.colormap as Colormap, domain };
}
