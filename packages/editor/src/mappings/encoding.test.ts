import { describe, expect, it } from 'vitest';
import { encodingOf, encodingSummary, fieldCompatible, labelNode, nodeOf } from './encoding.js';
import { optionValue } from '../domain/views.js';
import { numericConstraint, numericIssue } from './numeric.js';

describe('encodings preserve latkit values', () => {
  it('round-trips scalar, compound and field values, with every domain latkit takes', () => {
    const cases = [
      ['color', 'color', { colormap: 'viridis', value: '$params.kv', domain: [69, 765] }],
      ['color', 'color', { colormap: 'rdbu', value: '$simulation.Vm', domain: 'all' }],
      ['color', 'color', { colormap: 'rdbu', value: '$simulation.Vm~change', domain: [-0.1, 0.1] }],
      ['color', 'color', { colormap: { kind: 'sequential', colors: [[0, '#185e9c'], [1, '#860f27']] }, value: '$params.kv', domain: [60, 800] }],
      ['color', 'color', '#123456'],
      ['radius', 'number', { scale: [3, 12], value: '$params.kv' }],
      ['radius', 'number', '$params.kv'],
      ['radius', 'number', 7],
      ['label', 'label', { text: '$number', maxWidth: 100 }],
      ['label', 'label', { text: '$number' }],
      ['label', 'label', null],
    ] as const;
    for (const [name, control, value] of cases) {
      const encoding = encodingOf(value, control);
      expect(encoding.kind).not.toBe('formula');
      expect(optionValue(name, control === 'label' ? labelNode(encoding) : nodeOf(encoding))).toEqual(value);
    }
    expect(encodingOf(undefined, 'color')).toEqual({ kind: 'inherit' });
    expect(nodeOf({ kind: 'inherit' })).toBeUndefined();
  });
  it('keeps anything else as a formula, whole, so no reading loses its meaning', () => {
    const cases = [
      [{ field: 'params.kv', from: ['other', 'Bus'] }, 'number'],
      [{ scale: [3, 12], value: '$params.kv', clamp: false }, 'number'],
      [{ text: '$name', font: 'Custom Font' }, 'label'],
      [{ colormap: 'rdbu', value: { abs: { sub: ['$simulation.Vm', 1] } } }, 'color'],
      [{ fallback: ['$params.kv', 0] }, 'number'],
      ['$params.kv', 'color'],
      ['#123456', 'number'],
    ] as const;
    for (const [value, control] of cases) {
      const encoding = encodingOf(value, control);
      expect(encoding).toEqual({ kind: 'formula', node: value });
      expect(nodeOf(encoding)).toBe(value);
    }
  });
  it('rejects reversed domains and invalid limits', () => {
    const scale = { kind: 'scale' as const, field: 'params.kv', scale: [3, 12] as [number, number] };
    expect(() => nodeOf({ ...scale, domain: [765, 69] })).toThrow('maximum');
    expect(() => nodeOf({ kind: 'field', field: 'name', maxWidth: -1 })).toThrow('greater than zero');
  });
  it('keeps missing schema fields discoverable but excludes opaque fields from mappings', () => {
    const info = { id: 'params.kv', label: 'Voltage', kind: 'number', presence: { present: 0, total: 2 } } as const;
    expect(fieldCompatible(info, 'color')).toBe(true);
    expect(fieldCompatible({ ...info, kind: null }, 'color')).toBe(false);
    expect(fieldCompatible({ ...info, kind: 'text' }, 'label')).toBe(true);
    for (const id of ['placement.network.x', 'placement.network.y', 'placement.geographic.longitude', 'uuid']) {
      expect(fieldCompatible({ ...info, id }, 'color')).toBe(false);
      expect(fieldCompatible({ ...info, id }, 'label')).toBe(false);
    }
  });
  it('rejects negative dimensions without restricting signed elevation or reversed output ranges', () => {
    expect(() => nodeOf({ kind: 'fixed', value: -5 }, 'nonnegative')).toThrow('at least 0');
    expect(nodeOf({ kind: 'fixed', value: -5 })).toBe(-5);
    const scale = { kind: 'scale' as const, field: 'params.kv', scale: [12, 3] as [number, number] };
    expect(nodeOf(scale, 'nonnegative')).toMatchObject({ scale: [12, 3] });
    expect(() => nodeOf({ ...scale, scale: [12, -1] }, 'nonnegative')).toThrow('at least 0');
  });
  it('validates nonnegative radii while permitting signed elevation', () => {
    const limit = numericConstraint('radius');
    expect(nodeOf({ kind: 'fixed', value: 0 }, limit)).toBe(0);
    expect(numericIssue({ scale: [-1, 10], value: '$params.kv' }, limit)).toContain('at least 0');
    expect(numericIssue('$params.kv', limit, () => [100, -1])).toContain('Use an output range');
    expect(numericIssue('$params.kv', limit, () => [100, undefined])).toBeNull();
    expect(numericIssue(-10, numericConstraint('elevation'))).toBeNull();
  });
  it('sums an option up in a few words', () => {
    const name = (field: string) => field.toUpperCase();
    expect(encodingSummary({ kind: 'inherit' }, 'number', name, 'Fit')).toBe('Fit');
    expect(encodingSummary({ kind: 'off' }, 'label', name, '')).toBe('Off');
    expect(encodingSummary({ kind: 'off' }, 'color', name, '')).toBe('Endpoint colors');
    expect(encodingSummary({ kind: 'fixed', value: 'var(--color-bg)' }, 'color', name, '')).toBe('Theme color');
    expect(encodingSummary({ kind: 'scale', field: 'kv', scale: [0, 1] }, 'number', name, '')).toBe('KV');
    expect(encodingSummary({ kind: 'formula', node: { units: 2, atMost: 5 } }, 'number', name, '')).toBe('Up to 5');
    expect(encodingSummary({ kind: 'formula', node: { abs: '$x' } }, 'number', name, '')).toBe('Formula');
  });
});
