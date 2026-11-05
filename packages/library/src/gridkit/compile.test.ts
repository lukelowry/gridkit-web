import { expect, it } from 'vitest';
import ieee39 from '../../../../library/IEEE39.case.json';
import wecc240 from '../../../../library/WECC240.case.json';
import { createCase, parseCase } from '../case.js';
import { CaseDocument } from '../document.js';
import { compile, defaultStudy } from './index.js';

for (const fixture of [ieee39, wecc240]) it(`${fixture.header.case_name}: a compiled study keeps native connections and captures its study settings`, async () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture))), study = defaultStudy();
  const original = document.export(), compiled = compile(document, study);

  study.tmax = 99;
  const text = await compiled.model.text(), captured = parseCase(text);
  expect(compiled.study.tmax).toBe(10);
  for (const collection of ['buses', 'devices', 'signals'] as const) {
    const native = (rows: readonly unknown[]) => rows.map(row => {
      // GridKit is told what to record and what to call it; geographic placement is presentation data.
      const { $ui, extension, mon, name, ...value } = row as Record<string, unknown>;
      return value;
    });
    expect(native(captured[collection]!)).toEqual(native(original[collection]!));
  }
  expect(text).not.toContain('$ui');
  // GridKit's real and integer fields stay what its parser expects.
  expect(text).toMatch(/"kv":\d+\.\d/);
  const { channels } = compiled;
  expect(channels.filter(channel => channel.output === 'Vm')).toHaveLength(fixture.buses.length);
  expect(new Set(channels.map(channel => channel.column)).size).toBe(channels.length);
});

it('names each recorded output as GridKit names its column, under Bus for every bus class', async () => {
  const document = new CaseDocument({ ...createCase(), buses: [
    { class: 'Bus', number: 1, name: '', params: {} },
    { class: 'BusInfinite', number: 2, name: '', params: {} },
  ] });
  const { channels, model } = compile(document, defaultStudy());
  expect(channels.map(channel => channel.column)).toEqual(['Bus_1_Va', 'Bus_1_Vm', 'Bus_2_Va', 'Bus_2_Vm']);
  const buses = JSON.parse(await model.text()).buses;
  expect(buses.map((bus: { name: string; mon: string[] }) => [bus.name, bus.mon])).toEqual([['1', ['Va', 'Vm']], ['2', ['Va', 'Vm']]]);
});

it('lets IDA take as many steps as it needs unless the study sets a limit', () => {
  const document = new CaseDocument(createCase());
  expect(compile(document, defaultStudy()).study).toMatchObject({ max_steps: Number.MAX_SAFE_INTEGER, rel_tol: 1e-5, abs_tol: 1e-5 });
  expect(compile(document, { ...defaultStudy(), max_steps: 5, rel_tol: 1e-3 }).study).toMatchObject({ max_steps: 5, rel_tol: 1e-3 });
  expect(compile(document, { ...defaultStudy(), rel_tol: undefined, abs_tol: undefined, max_steps: undefined }).study)
    .toMatchObject({ max_steps: Number.MAX_SAFE_INTEGER, rel_tol: 1e-5, abs_tol: 1e-5 });
  expect(compile(document, { ...defaultStudy(), max_steps: 0 }).study.max_steps).toBe(0);
});

it('refuses identifiers a recording cannot hold', () => {
  const value = parseCase(JSON.stringify(ieee39));
  const document = new CaseDocument({ ...value, devices: value.devices.map(row =>
    row.class === 'Genrou' ? { ...row, id: 'a,b' } : row) });
  expect(() => compile(document, defaultStudy())).toThrow('a,b');
});
