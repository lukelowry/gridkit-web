import { expect, it } from 'vitest';
import { affine, defaultBand, fieldOf, measureOf, measureUnit, percentable, referenceField, type Basis } from './measure.js';

it('names one sampled field for each measure, and reads it back', () => {
  for (const basis of ['value', 'change', 'percent'] as Basis[]) expect(measureOf(fieldOf({ output: 'Vm', basis }))).toEqual({ output: 'Vm', basis });
  expect(fieldOf({ output: 'Vm', basis: 'value' })).toBe('Vm');
  expect(fieldOf({ output: 'Vm', basis: 'change' })).toBe('Vm~change');
  expect(referenceField('Vm')).toBe('Vm~from');
});

it('takes every basis as an offset and a positive scale, so a summary keeps its order', () => {
  const at = (basis: Basis, reference: number, value: number) => { const { offset, scale } = affine(basis, reference); return (value - offset) * scale; };
  expect(at('value', 2, 3)).toBe(3);
  expect(at('change', 2, 3)).toBe(1);
  expect(at('percent', 2, 3)).toBe(50);
  // A negative reference still scales positively: a rise reads as a rise.
  expect(at('percent', -2, -1)).toBe(50);
  expect(affine('percent', -2).scale).toBeGreaterThan(0);
  expect(at('percent', 0, 3)).toBeNaN();
});

it('keeps a change in its unit and a percent in its own, and an angle has no percent', () => {
  expect(measureUnit('p.u.', 'change')).toBe('p.u.');
  expect(measureUnit('p.u.', 'percent')).toBe('%');
  expect(percentable('rad')).toBe(false);
  expect(percentable('p.u.')).toBe(true);
});

it('gives every deviation a band, from the output where it has its own', () => {
  expect(defaultBand({ output: 'Vm', basis: 'change' })).toBe(0.1);
  expect(defaultBand({ output: 'omega', basis: 'percent' })).toBe(5);
  expect(defaultBand({ output: 'omega', basis: 'change' })).toBe(1);
});
