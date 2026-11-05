import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { Data, load, Patch } from 'latkit';
import input from '../../../library/test/small.case.json';
import { busName, CaseDocument, elementFields, parseCase } from '@gridkit/library';
import { dataset, refOf, rowsOf, tableColumns, tables, writeRows } from './data.js';
import { entriesOf } from '../domain/entries.js';
import { columns, tableSource } from '../table/rows.js';

const fixture = parseCase(JSON.stringify(input));
await load({ wasm: await WebAssembly.compile(readFileSync(createRequire(import.meta.url).resolve('latkit/wasm'))) });
function project(document: CaseDocument) {
  const patch = new Patch();
  for (const [table, rows] of tables(document)) writeRows(patch, table, tableColumns(document, table), rows);
  return new Data(dataset).apply(patch);
}

it('derives bus identity labels without changing imported case data', () => {
  for (const [name, model, label] of [['North', 'Bus', 'North (1)'], ['  ', 'Bus', 'Bus 1'], ['', 'BusInfinite', 'Bus 1\nInfinite bus']] as const) {
    const document = new CaseDocument(parseCase(JSON.stringify({ ...input, buses: [{ ...input.buses[0], name, class: model }] })));
    const bus = document.rows('buses')[0]!;
    expect(elementFields(bus).displayLabel).toBe(label);
    expect(document.export().buses[0]).not.toHaveProperty('displayLabel');
    expect(busName(bus)).toBe(name.trim() ? 'North (1)' : 'Bus 1');
  }
});

it('keys rows by element identity and leaves unresolved connections unwired', () => {
  const document = new CaseDocument(fixture), data = project(document);
  const [north, south] = document.rows('buses'), [line] = document.rows('devices'), [signal] = document.rows('signals');
  expect(data.describe().tables.map(table => table.name)).toEqual(['Branch', 'Bus', 'Signal']);
  expect(data.query({ of: 'Bus', select: {} }).ids).toEqual([north!.ref.id, south!.ref.id]);
  expect(data.get('Branch', line!.ref.id, 'ports.bus1')).toBe(north!.ref.id);
  expect(data.get('Bus', north!.ref.id, 'params.kv')).toBe(230);
  expect(data.get('Bus', north!.ref.id, 'placement.geographic.longitude')).toBe(-90.1);
  expect(data.get('Bus', north!.ref.id, 'placement.network.x')).toBeNull();
  const fields = data.describe().tables.find(table => table.name === 'Bus')!.fields.map(field => field.name);
  expect(fields).not.toContain('uuid'); expect(fields).not.toContain('$bus');
  expect(refOf({ table: 'Branch', id: line!.ref.id })).toEqual(line!.ref);
  expect(refOf({ table: 'Signal', id: signal!.ref.id })).toEqual(signal!.ref);
  expect(rowsOf(document, document.rows('devices')[1]!.ref)).toEqual([]);
  const ambiguous = new CaseDocument({ ...fixture, buses: [fixture.buses[0]!, ...fixture.buses] }), unresolved = project(ambiguous);
  expect(unresolved.get('Branch', ambiguous.rows('devices')[0]!.ref.id, 'ports.bus1')).toBeNull();
  data.destroy(); unresolved.destroy();
});

it('leaves fields of mixed kinds out', () => {
  const mixed = new CaseDocument({ ...fixture, buses: fixture.buses.map((bus, index) => ({ ...bus, params: { kv: index ? 'unknown' : 230 } })) });
  const data = project(mixed);
  expect(data.describe().tables.find(table => table.name === 'Bus')!.fields.map(field => field.name)).not.toContain('params.kv');
  data.destroy();
});

it.each([['First', true], ['Restored', false]] as const)('preserves imported text and boolean scalar kinds (%s)', (note, enabled) => {
  const document = new CaseDocument({ ...fixture, buses: fixture.buses.map((bus, index) => index ? bus : { ...bus, params: { ...bus.params, note, enabled } }) });
  const data = project(document), [north, south] = document.rows('buses');
  expect([data.get('Bus', north!.ref.id, 'params.note'), data.get('Bus', north!.ref.id, 'params.enabled')]).toEqual([note, enabled]);
  expect([data.get('Bus', south!.ref.id, 'params.note'), data.get('Bus', south!.ref.id, 'params.enabled')]).toEqual([null, null]);
  data.destroy();
});

it('initializes signal identities and resolves device signal ports', () => {
  const document = new CaseDocument(parseCase(JSON.stringify({ ...input, devices: [
    { class: 'Ieeet1', id: 'exciter', ports: { bus: 1, efd: 0 }, params: {} },
    { class: 'Genrou', id: 'machine', ports: { bus: 1, efd: 0 }, params: {} },
  ], signals: [{ signal_id: 0, name: 'Control' }] })));
  const data = project(document), signal = document.rows('signals')[0]!.ref;
  expect(data.query({ of: 'Signal', select: {} }).ids).toEqual([signal.id]);
  for (const device of document.rows('devices')) expect(data.get(String(device.value.class), device.ref.id, 'ports.efd')).toBe(signal.id);
  expect(data.get('Signal', signal.id, 'name')).toBe('Control');
  data.destroy();
});

it.each([undefined, 2])('keeps branch ports as references when imported endpoints are %s', bus2 => {
  const document = new CaseDocument(parseCase(JSON.stringify({ ...input, devices: [
    { ...input.devices[0], ports: { bus1: 1, ...(bus2 === undefined ? {} : { bus2 }) } },
    { ...input.devices[0], id: 'spur', ports: { bus1: 1 } },
  ] })));
  const data = project(document), [line, spur] = document.rows('devices');
  expect(tableColumns(document, 'Branch').find(([name]) => name === 'ports.bus2')?.[1]).toBe('reference');
  expect(data.get('Branch', line!.ref.id, 'ports.bus2')).toBe(bus2 === undefined ? null : document.find('buses', 2)!.id);
  expect(data.get('Branch', spur!.ref.id, 'ports.bus2')).toBeNull();
  data.destroy();
});

it('keeps table identity through filtering and sorting while showing native bus numbers', () => {
  const document = new CaseDocument(parseCase(JSON.stringify({ ...input,
    buses: input.buses.map((bus, index) => index ? bus : { ...bus, number: 99 }),
    devices: input.devices.map((device, index) => index ? device : { ...device, ports: { bus1: 99, bus2: 2 } }),
  })));
  const rows = entriesOf(document), source = tableSource(rows);
  const sort = { column: columns.findIndex(column => column.key === 'name'), dir: 'desc' } as const;
  expect(source.window('Bus', sort, 0, 10)).toMatchObject({ rows: [{ key: rows[1]!.id }, { key: rows[0]!.id }] });
  expect(source.locate!(rows[0]!.id, 'Bus', sort)).toBe(1);
  expect(rows[0]).toMatchObject({ label: '99' });
  expect(rows[2]!.fields['ports.bus1']).toBe(99);
});
