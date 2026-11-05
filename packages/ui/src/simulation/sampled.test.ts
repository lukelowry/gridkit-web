import type { Channel } from '@gridkit/library/gridkit';
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Data, load } from 'latkit';
import fixture from '../../../../library/IEEE39.case.json';
import { CaseDocument, parseCase } from '@gridkit/library';
import { affine, fieldOf, referenceField } from '../domain/measure.js';
import { matchesField, sampledExpression, sampledName, simulationDataset, simulationExpression, simulationFields, simulationOption } from './sampled.js';

beforeAll(async () => { await load({ wasm: await WebAssembly.compile(new Uint8Array(await readFile(new URL(import.meta.resolve('latkit/wasm'))))) }); });

const channels: Channel[] = [{ column: 'v1', element: { collection: 'buses', id: 'b1' }, class: 'Bus', output: 'Vm', unit: 'p.u.', label: '1' }];

it('offers what a run records before any run, and a safe fallback without results', () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture))), fields = simulationFields(document);
  const sampled = (target: Parameters<typeof fields>[0]) => fields(target).filter(field => field.id.startsWith('simulation.'));
  expect(sampled({ collection: 'buses' }).map(field => [field.id, field.label, field.unit])).toEqual([
    ['simulation.Vm', 'Voltage magnitude', 'p.u.'], ['simulation.Va', 'Voltage angle', 'rad']]);
  expect(sampled({ collection: 'buses' })[0]!.presence).toEqual({ present: fixture.buses.length, total: fixture.buses.length });
  expect(sampled({ collection: 'signals' })).toEqual([]);
  // The list is one per view of the case: the same answer without another scan.
  expect(fields({ collection: 'buses' })).toBe(fields({ collection: 'buses' }));
  expect(simulationExpression('$simulation.Vm', false)).toBeNull();
  const mapping = {scale:[0,10], domain:[0.9,1.1], value:'$simulation.Vm'};
  const rendered = JSON.stringify(simulationExpression(mapping, true));
  expect(rendered).toContain('simulation');
  expect(rendered).toContain('buses');
  expect(rendered).not.toContain('step');
  expect(rendered).not.toContain('clamp');
  expect(rendered).toContain('Vm');
  expect(rendered).not.toContain('$simulation.');
  expect(mapping.value).toBe('$simulation.Vm');
});

it('matches a channel to every measure of its output, and names a sampled field by its own name', () => {
  expect(matchesField(channels[0]!, { collection: 'buses', field: 'Vm' })).toBe(true);
  expect(matchesField(channels[0]!, { collection: 'buses', field: 'Vm~percent' })).toBe(true);
  expect(matchesField(channels[0]!, { collection: 'buses', field: 'Va~change' })).toBe(false);
  expect(matchesField(channels[0]!, { collection: 'devices', field: 'Vm' })).toBe(false);
  expect(sampledName('simulation.Vm~change')).toBe('Vm~change');
  expect(sampledName('params.kv')).toBeNull();
  // A deviation reads the output and the reference the recording keeps beside it, never a field of its own.
  const change = JSON.stringify(simulationExpression('$simulation.Vm~change', true));
  expect(change).toContain(`"${referenceField('Vm')}"`);
  expect(change).not.toContain('"Vm~change"');
  expect(JSON.stringify(simulationExpression({ field: 'simulation.Vm~change', step: true }, true))).toContain('step');
});

it('reads every measure of an output as the plot reads it, from what the recording holds', () => {
  const data = new Data(simulationDataset).axis('Time', 's'), ids = ['a', 'b', 'c'], references = [1, 2, 0], values = [1.5, 1.25, 0.5];
  try {
    data.replace('buses', ids, {});
    data.append('buses', [0, 1], { Vm: Float32Array.of(...references, ...values) }, { ids });
    data.set('buses', ids, { [referenceField('Vm')]: references });
    for (const basis of ['value', 'change', 'percent'] as const) {
      const read = data.query({ of: 'buses', at: 1, select: { v: sampledExpression(fieldOf({ output: 'Vm', basis }), { collection: 'buses' }) } });
      // The plot's affine, where a zero reference has no percent.
      expect([...read.fields.v as Float64Array]).toEqual(values.map((value, i) => { const { offset, scale } = affine(basis, references[i]!); return (value - offset) * scale; }));
    }
  } finally { data.destroy(); }
});

it('binds every property independently and keeps device identity separate', () => {
  for (const property of ['color', 'radius', 'elevation', 'visible']) {
    const option = simulationOption({ scale: [0, 10], value: '$simulation.omega', domain: [0.9, 1.1] }, true, { collection: 'devices' }, 0);
    const text = JSON.stringify({ [property]: option });
    expect(text).toContain('devices'); expect(text).toContain('omega');
    expect(text).not.toContain('Vm'); expect(text).not.toContain('$simulation.');
  }
  expect(simulationOption('#ffffff', true, { collection: 'buses' }, '#888888')).toBe('#ffffff');
});

it('activates each property only after its selected field is committed', () => {
  const target = { collection: 'buses' } as const;
  const color = { colormap: 'viridis', value: '$simulation.Vm', domain: [0, 1.3] };
  const radius = { scale: [2, 8], value: '$simulation.Va', domain: [-Math.PI, Math.PI] };
  const ready = new Set(['Vm']);
  expect(simulationOption(color, ready, target, '#888888')).not.toBe('#888888');
  expect(simulationOption(radius, ready, target, 4)).toBe(4);
  ready.add('Va');
  expect(JSON.stringify(simulationOption(radius, ready, target, 4))).toContain('Va');
  // Without a domain, a sampled colormap spans every recorded value, so colors hold still during playback.
  expect(simulationOption({ colormap: 'viridis', value: '$simulation.Vm' }, ready, target, '#888888'))
    .toMatchObject({ fallback: [{ colormap: 'viridis', domain: 'all' }, '#888888'] });
});

it('centers a deviation on no change, whatever the run recorded', () => {
  const target = { collection: 'buses' } as const;
  expect(simulationOption({ colormap: 'rdbu', value: '$simulation.Vm~change' }, new Set(['Vm']), target, '#888888'))
    .toMatchObject({ fallback: [{ colormap: 'rdbu', domain: [-0.1, 0.1] }, '#888888'] });
  expect(simulationOption({ colormap: 'rdbu', value: '$simulation.Vm~percent', domain: [-2, 2] }, new Set(['Vm']), target, '#888888'))
    .toMatchObject({ fallback: [{ domain: [-2, 2] }, '#888888'] });
  // A deviation waits for its output's samples, and needs nothing else installed.
  expect(simulationOption({ colormap: 'rdbu', value: '$simulation.Vm~change' }, new Set(['Va']), target, '#888888')).toBe('#888888');
});
