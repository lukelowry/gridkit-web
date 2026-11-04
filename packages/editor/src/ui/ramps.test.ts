import { expect, it } from 'vitest';
import { colorScaleOf } from '../mappings/encoding.js';
import { diverges, paletteLabel, palettes, scaleTicks } from './ramps.js';
import { measureColor, measureHeight } from '../mappings/defaults.js';

it('leads with diverging palettes for a deviation, and offers no categories', () => {
  expect(palettes(false)[0]!.kind).toBe('sequential');
  expect(palettes(true)[0]!.kind).toBe('diverging');
  expect(palettes(true).map(map => map.name)).toContain('rdbu');
  expect(palettes(true).map(map => map.name)).not.toContain('tab10');
  expect(diverges('rdbu')).toBe(true);
  expect(diverges('viridis')).toBe(false);
  expect(paletteLabel('rdbu')).toBe('Red / Blue');
});

it('reads a mark\'s colormap as a scale, and names its values at their places', () => {
  const color = measureColor({ output: 'Vm', basis: 'change' });
  expect(colorScaleOf(color)).toEqual({ field: 'simulation.Vm~change', map: 'rdbu', domain: [-0.1, 0.1] });
  expect(colorScaleOf({ colormap: 'viridis', value: '$params.kv', domain: 'all' })).toMatchObject({ domain: null });
  expect(colorScaleOf('#123456')).toBeNull();
  expect(scaleTicks('rdbu', [-0.1, 0.1], true).map(tick => tick.text)).toEqual(['-0.1', '0', '+0.1']);
  expect(scaleTicks('rdbu', [0.8, 1.2], false).map(tick => tick.text)).toEqual(['0.8', '1', '1.2']);
  expect(scaleTicks('viridis', [60, 800], false).map(tick => tick.at)).toEqual([0, 1]);
  expect(scaleTicks('viridis', null, false).map(tick => tick.text)).toEqual(['Least', 'Most']);
});

it('colors and raises a bus by its measure: as recorded on its own map, a deviation around no change', () => {
  expect(measureColor({ output: 'Vm', basis: 'value' })).toEqual({ colormap: 'rdbu', value: '$simulation.Vm', domain: [0.8, 1.2] });
  expect(measureColor({ output: 'Va', basis: 'value' })).toEqual({ colormap: 'twilight', value: '$simulation.Va', domain: [-Math.PI, Math.PI] });
  expect(measureColor({ output: 'Vm', basis: 'percent' })).toEqual({ colormap: 'rdbu', value: '$simulation.Vm~percent', domain: [-10, 10] });
  // A band asked for reaches as far either way.
  expect(measureColor({ output: 'Vm', basis: 'change' }, 0.02).domain).toEqual([-0.02, 0.02]);
  expect(measureColor({ output: 'x', basis: 'value' }).domain).toBe('all');
  expect(measureHeight({ output: 'Vm', basis: 'value' }, 20)).toEqual({ scale: [0, 20], value: '$simulation.Vm', domain: [0, 1.3] });
  expect(measureHeight({ output: 'Vm', basis: 'change' }, 20, 0.02)).toEqual({ scale: [0, 20], value: '$simulation.Vm~change', domain: [-0.02, 0.02] });
});

