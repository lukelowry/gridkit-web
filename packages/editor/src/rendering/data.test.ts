import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { Data, load, Patch } from 'latkit';
import input from '../../../library/test/small.case.json';
import { busName, CaseDocument, createCase, elementFields, parseCase, type ElementRef } from '@gridkit/library';
import { createEditor } from '../app/case-editor.svelte.js';
import { changedColumns, dataset, refOf, rowsOf, tableColumns, tables, writeChanges, writeRows,
  type Column, type Written } from './data.js';
import { entriesOf } from '../domain/entries.js';
import { columns, tableSource } from '../table/rows.js';
import { editCase } from '../domain/views.js';

const fixture = parseCase(JSON.stringify(input));
await load({ wasm: await WebAssembly.compile(readFileSync(createRequire(import.meta.url).resolve('latkit/wasm'))) });
function project(document: CaseDocument) {
  const patch = new Patch();
  for (const [table, rows] of tables(document)) writeRows(patch, table, tableColumns(document, table), rows, true);
  return new Data(dataset).apply(patch);
}

it('derives bus identity labels without changing case data', () => {
  const editor = createEditor(); editor.open(fixture);
  const bus = editor.document.rows('buses')[0]!;
  editor.edit('Rename bus', tx => tx.update(bus.ref, { name: 'North' }));
  expect(elementFields(editor.document.get(bus.ref)!).displayLabel).toBe('North (1)');
  expect(editor.snapshot().value.buses[0]).not.toHaveProperty('displayLabel');
  editor.edit('Clear name', tx => tx.update(bus.ref, { name: '  ' }));
  expect(elementFields(editor.document.get(bus.ref)!).displayLabel).toBe('Bus 1');
  expect(elementFields({ ...bus, value: { ...bus.value, name: '', class: 'BusInfinite' } }).displayLabel).toBe('Bus 1\nInfinite bus');
  // Titles and announcements name a bus without its model line.
  expect(busName({ ...bus, value: { ...bus.value, name: 'North', class: 'BusInfinite' } })).toBe('North (1)');
  editor.undo();
  expect(elementFields(editor.document.get(bus.ref)!).displayLabel).toBe('North (1)');
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
  expect(data.describe().tables.find(table => table.name === 'Bus')!.fields.map(field => field.name)).not.toContain('uuid');
  expect(data.describe().tables.find(table => table.name === 'Bus')!.fields.map(field => field.name)).not.toContain('$bus');
  expect(refOf({ table: 'Branch', id: line!.ref.id })).toEqual(line!.ref);
  expect(refOf({ table: 'Signal', id: signal!.ref.id })).toEqual(signal!.ref);
  expect(rowsOf(document, document.rows('devices')[1]!.ref)).toEqual([]);
  const ambiguous = new CaseDocument({ ...fixture, buses: [fixture.buses[0]!, ...fixture.buses] });
  expect(project(ambiguous).get('Branch', ambiguous.rows('devices')[0]!.ref.id, 'ports.bus1')).toBeNull();
});

it('leaves fields of mixed kinds out', () => {
  const mixed = new CaseDocument({ ...fixture, buses: fixture.buses.map((bus, index) => ({ ...bus, params: { kv: index ? 'unknown' : 230 } })) });
  expect(project(mixed).describe().tables.find(table => table.name === 'Bus')!.fields.map(field => field.name)).not.toContain('params.kv');
});

it('keeps unchanged rows identical, and sets the rows an edit changed over the rest', () => {
  const editor = createEditor(); editor.open(fixture);
  const data = project(editor.document), before = tables(editor.document), [north, south] = editor.document.rows('buses');
  editor.edit('Rename', tx => tx.update(north!.ref, { name: 'Renamed' }));
  const after = tables(editor.document);
  expect(after.get('Branch')![0]).toBe(before.get('Branch')![0]);
  expect(after.get('Bus')![1]).toBe(before.get('Bus')![1]);
  const changed = after.get('Bus')!.filter((row, index) => row !== before.get('Bus')![index]);
  expect(changed.map(row => row.ref)).toEqual([north!.ref]);
  const columns = changedColumns(tableColumns(editor.document, 'Bus'), [north!], changed);
  expect(columns.map(([name]) => name)).toEqual(['name', 'displayLabel']);
  const patch = new Patch();
  writeRows(patch, 'Bus', columns, changed, false);
  data.apply(patch);
  expect([data.get('Bus', north!.ref.id, 'name'), data.get('Bus', south!.ref.id, 'name')]).toEqual(['Renamed', 'South']);
  expect(data.query({ of: 'Bus', select: {} }).ids).toEqual([north!.ref.id, south!.ref.id]);
  editor.undo();
  expect(tables(editor.document).get('Bus')![0]).toBe(before.get('Bus')![0]);
});

it('updates one field without replacing tables and keeps snapshots available for undo', () => {
  const editor = createEditor(); editor.open(fixture);
  const document = editor.document, written: Written = new Map(), data = new Data(dataset);
  const changes = () => {
    const patch = new Patch(dataset);
    const set = vi.spyOn(patch, 'set'), replace = vi.spyOn(patch, 'replace');
    const changed = writeChanges(patch, written, tables(document), table => tableColumns(document, table));
    if (changed) data.apply(patch);
    return { changed, set, replace };
  };
  expect(changes().changed).toBe(true);
  const before = data.snapshot(), [north, south] = document.rows('buses');
  editor.edit('Change voltage', tx => tx.update(north!.ref, { params: { ...north!.value.params, kv: 345 } }));
  const edit = changes();
  expect(edit.changed).toBe(true);
  expect(edit.replace).not.toHaveBeenCalled();
  expect(edit.set).toHaveBeenCalledExactlyOnceWith('Bus', [north!.ref.id], { 'params.kv': Float64Array.of(345) });
  expect(data.get('Bus', north!.ref.id, 'params.kv')).toBe(345);
  expect(before.get('Bus', north!.ref.id, 'params.kv')).toBe(230);
  expect(data.get('Bus', south!.ref.id, 'params.kv')).toBe(before.get('Bus', south!.ref.id, 'params.kv'));
  const unchanged = changes();
  expect(unchanged.changed).toBe(false);
  expect(unchanged.set).not.toHaveBeenCalled();
  expect(unchanged.replace).not.toHaveBeenCalled();
  data.restore(before);
  expect(data.get('Bus', north!.ref.id, 'params.kv')).toBe(230);
  before.destroy(); data.destroy();
});

it('sets the first text and boolean values, clears them, and restores them without replacing or rewriting other rows', () => {
  const document = new CaseDocument(fixture), [north, south] = document.rows('buses');
  const written: Written = new Map(), data = new Data(dataset);
  const columns: Column[] = [
    ['note', 'text', (_, fields) => fields.map(row => typeof row['params.note'] === 'string' ? row['params.note'] : null)],
    ['enabled', 'bool', (_, fields) => fields.map(row => typeof row['params.enabled'] === 'boolean' ? row['params.enabled'] : null)],
  ];
  const write = () => {
    const patch = new Patch(), set = vi.spyOn(patch, 'set'), replace = vi.spyOn(patch, 'replace');
    writeChanges(patch, written, new Map([['Bus', document.rows('buses')]]), () => columns);
    data.apply(patch);
    return { set, replace };
  };
  write();
  for (const [note, enabled] of [['First', true], [null, null], ['Restored', false]] as const) {
    editCase(document, tx => tx.update(north!.ref, { params: { ...north!.value.params, note, enabled } }));
    const patch = write();
    expect(patch.replace).not.toHaveBeenCalled();
    expect(patch.set).toHaveBeenCalledExactlyOnceWith('Bus', [north!.ref.id], { note: [note], enabled: [enabled] });
    expect([data.get('Bus', north!.ref.id, 'note'), data.get('Bus', north!.ref.id, 'enabled')]).toEqual([note, enabled]);
    expect([data.get('Bus', south!.ref.id, 'note'), data.get('Bus', south!.ref.id, 'enabled')]).toEqual([null, null]);
  }
  data.destroy();
});

it('initializes the first signal identities and resolves its ports, then updates the signal in place', () => {
  const document = new CaseDocument(createCase()), written: Written = new Map(), data = new Data(dataset);
  let bus!: ElementRef<'buses'>, exciter!: ElementRef, machine!: ElementRef;
  editCase(document, tx => {
    bus = tx.add('Bus') as ElementRef<'buses'>; exciter = tx.add('Ieeet1'); machine = tx.add('Genrou');
    for (const element of [exciter, machine]) tx.connect({ element, port: 'bus' }, bus);
  });
  const write = () => {
    const patch = new Patch(), replace = vi.spyOn(patch, 'replace');
    writeChanges(patch, written, tables(document), table => tableColumns(document, table));
    data.apply(patch);
    return replace;
  };
  write();
  editCase(document, tx => tx.connect({ element: exciter, port: 'efd' }, { element: machine, port: 'efd' }));
  write();
  const signal = document.rows('signals')[0]!.ref;
  expect(data.query({ of: 'Signal', select: {} }).ids).toEqual([signal.id]);
  for (const [table, ref] of [['Ieeet1', exciter], ['Genrou', machine]] as const)
    expect(data.get(table, ref.id, 'ports.efd')).toBe(signal.id);
  editCase(document, tx => tx.update(signal, { name: 'Control' }));
  expect(write()).not.toHaveBeenCalled();
  expect(data.get('Signal', signal.id, 'name')).toBe('Control');
  data.destroy();
});

it('keeps each field the kind latkit holds it as while connections come and go', () => {
  const editor = createEditor();
  let north!: ElementRef<'buses'>, south!: ElementRef<'buses'>, line!: ElementRef, spur!: ElementRef;
  editor.edit('Build', tx => {
    north = tx.addBus({ class: 'Bus', name: 'North', params: { kv: 230 } }); south = tx.addBus({ class: 'Bus', name: 'South', params: { kv: 230 } });
    line = tx.add('Branch'); tx.connect({ element: line, port: 'bus1' }, north);
  });
  const document = editor.document, written: Written = new Map(), data = new Data(dataset);
  const write = () => {
    const patch = new Patch(), replace = vi.spyOn(patch, 'replace'), wasWritten = written.has('Branch');
    writeChanges(patch, written, tables(document), table => tableColumns(document, table));
    data.apply(patch);
    if (wasWritten) expect(replace).not.toHaveBeenCalled();
    return data.get('Branch', line.id, 'ports.bus2');
  };
  // No branch reaches a far bus yet; its missing-only reference accepts the first connection in place.
  expect(write()).toBeNull();
  editor.edit('Connect', tx => tx.connect({ element: line, port: 'bus2' }, south));
  expect(write()).toBe(south.id);
  // A branch added without a far bus, and one disconnected while another holds one, keep the field's kind.
  editor.edit('Add', tx => { spur = tx.add('Branch'); tx.connect({ element: spur, port: 'bus1' }, north); });
  expect(write()).toBe(south.id);
  expect(data.get('Branch', spur.id, 'ports.bus2')).toBeNull();
  editor.edit('Connect', tx => tx.connect({ element: spur, port: 'bus2' }, south));
  write();
  editor.edit('Disconnect', tx => tx.disconnect({ element: line, port: 'bus2' }));
  expect(write()).toBeNull();
  expect(data.get('Branch', spur.id, 'ports.bus2')).toBe(south.id);
  // The last far bus gone, and one again.
  editor.edit('Disconnect', tx => tx.disconnect({ element: spur, port: 'bus2' }));
  expect([write(), data.get('Branch', spur.id, 'ports.bus2')]).toEqual([null, null]);
  editor.edit('Connect', tx => tx.connect({ element: line, port: 'bus2' }, south));
  expect(write()).toBe(south.id);
});

it('keeps table identity through filtering, sorting and renumbering', () => {
  const document = new CaseDocument(fixture);
  const rows = entriesOf(document);
  const source = tableSource(rows);
  const sort = { column: columns.findIndex(column => column.key === 'name'), dir: 'desc' } as const;
  expect(source.window('Bus', sort, 0, 10)).toMatchObject({ rows: [{ key: rows[1]!.id }, { key: rows[0]!.id }] });
  expect(source.locate!(rows[0]!.id, 'Bus', sort)).toBe(1);
  editCase(document, tx => tx.update(rows[0]!, { number: 99 }));
  expect(entriesOf(document)[0]).toMatchObject({ id: rows[0]!.id, label: '99' });
  expect(entriesOf(document)[2]!.fields['ports.bus1']).toBe(99);
});
