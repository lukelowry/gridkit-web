import type { Channel } from '@gridkit/library/gridkit';
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Data, load } from 'latkit';
import fixture from '../../../../library/IEEE39.case.json';
import { CaseDocument, parseCase } from '@gridkit/library';
import { affine, fieldOf, referenceField } from '../domain/measure.js';
import { mappedOutputs, matchesField, sampledExpression, sampledName, simulationDataset, simulationExpression, simulationFields, simulationOption } from './sampled.js';

beforeAll(async () => { await load({ wasm: await WebAssembly.compile(new Uint8Array(await readFile(new URL(import.meta.resolve('latkit/wasm'))))) }); });

const channels: Channel[] = [{ column: 'v1', element: { collection: 'buses', id: 'b1' }, class: 'Bus', output: 'Vm', unit: 'p.u.', label: '1' }];

it('offers every output a run can record before any run, and a safe fallback without results', () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture))), fields = simulationFields(document);
  const sampled = (target: Parameters<typeof fields>[0]) => fields(target).filter(field => field.id.startsWith('simulation.'));
  expect(sampled({ collection: 'buses' }).map(field => [field.id, field.label, field.unit])).toEqual([
    ['simulation.Vr', 'Real voltage', 'p.u.'], ['simulation.Vi', 'Imaginary voltage', 'p.u.'], ['simulation.Vm', 'Voltage magnitude', 'p.u.'], ['simulation.Va', 'Voltage angle', 'rad']]);
  expect(sampled({ collection: 'buses' })[2]!.presence).toEqual({ present: fixture.buses.length, total: fixture.buses.length });
  // A branch's power, which no case monitors, is there to map: a run records what its mappings read.
  const branches = fixture.devices.filter(row => row.class === 'Branch').length;
  expect(sampled({ collection: 'devices', class: 'Branch' }).find(field => field.id === 'simulation.p1'))
    .toMatchObject({ label: 'Real power into from bus', presence: { present: branches } });
  expect(sampled({ collection: 'signals' })).toEqual([]);
  // Every view shares the immutable document's one lookup and its answers.
  expect(simulationFields(document)).toBe(fields);
  expect(fields({ collection: 'buses' })).toBe(fields({ collection: 'buses' }));
  expect(simulationExpression('$simulation.Vm', false)).toBeNull();
  const mapping = {scale:[0,10], domain:[0.9,1.1], value:'$simulation.Vm'};
  const rendered = JSON.stringify(simulationExpression(mapping, true));
  expect(rendered).toContain('simulation');
  expect(rendered).toContain('Bus');
  expect(rendered).not.toContain('step');
  expect(rendered).not.toContain('clamp');
  expect(rendered).toContain('Vm');
  expect(rendered).not.toContain('$simulation.');
  expect(mapping.value).toBe('$simulation.Vm');
});

it('asks a run to record each output the mappings read, once, of the elements they read it of', () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)));
  const flow = { scale: [-60, 60], value: '$simulation.p1', domain: [-2, 2] };
  const branches = { id: 'branches', target: { collection: 'devices', class: 'Branch' }, kind: 'edges', options: { flow, width: { scale: [1, 4], value: '$simulation.p1~change' } } };
  const buses = { id: 'buses', target: { collection: 'buses' }, kind: 'vertices', options: { color: { colormap: 'rdbu', value: '$simulation.Vr' }, radius: '$params.kv' } };
  expect(mappedOutputs(document, { network: { marks: [buses] } }, { network: { marks: [branches, buses] } })).toEqual([
    { collection: 'devices', class: 'Branch', output: 'p1' }, { collection: 'buses', output: 'Vr' }]);
  // Without mappings of what a run records, a run records only what it always does.
  expect(mappedOutputs(document, {}, {})).toEqual([]);
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
    data.replace('Bus', ids, {});
    data.append('Bus', [0, 1], { Vm: Float32Array.of(...references, ...values) }, { ids });
    data.set('Bus', ids, { [referenceField('Vm')]: references });
    for (const basis of ['value', 'change', 'percent'] as const) {
      const read = data.query({ of: 'Bus', at: 1, select: { v: sampledExpression(fieldOf({ output: 'Vm', basis }), { collection: 'buses' }) } });
      // The plot's affine, where a zero reference has no percent.
      expect([...read.fields.v as Float64Array]).toEqual(values.map((value, i) => { const { offset, scale } = affine(basis, references[i]!); return (value - offset) * scale; }));
    }
  } finally { data.destroy(); }
});

it('binds every property independently and keeps device identity separate', () => {
  for (const property of ['color', 'radius', 'elevation', 'visible']) {
    const option = simulationOption({ scale: [0, 10], value: '$simulation.omega', domain: [0.9, 1.1] }, true, { collection: 'devices', class: 'Genrou' }, 0);
    const text = JSON.stringify({ [property]: option });
    expect(text).toContain('Genrou'); expect(text).toContain('omega');
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
