import { expect, it } from 'vitest';
import fixture from '../test/small.case.json';
import { createCase, parseCase, serializeCase } from './case.js';
import { CaseDocument, type Transaction } from './document.js';

const input = () => parseCase(JSON.stringify(fixture));

it('shares immutable imported parameters and extras through edits and export', () => {
  const value = input(), document = new CaseDocument(value);
  const bus = document.find('buses', 1)!;
  expect(document.info.header).toBe(value.header);
  expect(document.info.params).toBe(value.params);
  expect(document.get(bus)!.value.params).toBe(value.buses[0]!.params);
  document.edit(tx => tx.update(bus, { name: 'Renamed' }));
  const saved = document.export();
  expect(saved.buses[0]!.params).toEqual(value.buses[0]!.params);
  expect(saved.devices[0]!.params).toBe(value.devices[0]!.params);
  expect(saved.extension).toBe(value.extension);
  expect(value.buses[0]!.name).toBe(fixture.buses[0]!.name);
});

it.each([undefined, () => 1, new Date(), Infinity, NaN, 1n, Symbol('invalid')])(
  'rejects non-JSON edit values without changing the document: %s', invalid => {
    const document = new CaseDocument(input()), before = document.export();
    const bus = document.find('buses', 1)!;
    expect(() => document.edit(tx => tx.update(bus, { params: { nested: [invalid] } }))).toThrow('params.nested.0');
    expect(() => document.edit(tx => tx.addSignal({ signal_id: 9, name: 'Invalid', extension: { nested: invalid } }))).toThrow('extension.nested');
    expect(document.export()).toEqual(before);
  },
);

it('freezes edited nested data even when its parent was already shallowly frozen', () => {
  const document = new CaseDocument(input());
  const nested = Object.freeze({ child: { value: 1 } });
  const bus = document.find('buses', 1)!;
  document.edit(tx => tx.update(bus, { params: { nested } }));
  expect(document.get(bus)!.value.params.nested).toBe(nested);
  expect(Object.isFrozen(nested.child)).toBe(true);
});

it('round trips metadata, native fields, opaque data, unresolved ports, and absent collections', () => {
  const value = input(), placement = { network: [20, 40], diagram: [1, 2] };
  const document = new CaseDocument({ ...value, buses: [{ ...value.buses[0]!, $editor: { version: 1, id: 'north', placement } }, value.buses[1]!] });
  const bus = document.find('buses', 1)!;
  // Obsolete placement metadata is dropped.
  expect(document.get(bus)!.placement).toEqual({ network: [20, 40], geographic: [-90.1, 35.1] });
  const saved = document.export();
  // An earlier editor's version stamp is read past and not written.
  expect(saved.buses[0]!.$editor).toEqual({ id: 'north', placement: { network: [20, 40] } });
  const restored = new CaseDocument(parseCase(serializeCase(saved)));
  expect(restored.find('buses', 1)).toEqual(bus);
  expect(restored.export()).toEqual(saved);
  const reordered = new CaseDocument({ ...saved, buses: [...saved.buses].reverse() });
  expect(reordered.find('buses', 1)).toEqual(bus);
  expect(reordered.get(bus)!.placement.network).toEqual([20, 40]);
  expect(saved.extension).toEqual(fixture.extension);
  expect(saved.devices[1]!.ports).toEqual({ input: 0 });
  expect(saved.devices[1]!.extension).toEqual(fixture.devices[1]!.extension);
  const { signals: _signals, ...withoutSignals } = createCase();
  expect(new CaseDocument(withoutSignals).export()).not.toHaveProperty('signals');
  const opaque = input();
  expect(new CaseDocument({ ...opaque, buses: [{ ...opaque.buses[0]!, extension: ['opaque'] }] }).export().buses[0]!.extension).toEqual(['opaque']);
});

it('retains element order and connections across renumbering, deletion and undo', () => {
  const document = new CaseDocument(input());
  const first = document.find('buses', 1)!;
  const second = document.find('buses', 2)!;
  const branch = document.find('devices', 'line-1')!;
  const before = document.export();
  const changed = document.edit(tx => {
    tx.update(first, { number: 2 });
    tx.update(second, { number: 1 });
    tx.connect({ element: branch, port: 'bus2' }, first);
  })!;
  expect(document.export().devices[0]!.ports).toEqual({ bus1: 2, bus2: 2 });
  document.apply(changed, 'backward');
  expect(document.export()).toEqual(before);
  const removed = document.edit(tx => tx.remove([first, branch]))!;
  expect(document.rows('buses').map(row => row.ref)).toEqual([second]);
  document.apply(removed, 'backward');
  expect(document.export()).toEqual(before);
});

it('validates the final transaction and does not leave partial writes or indexes', () => {
  const document = new CaseDocument(input());
  const before = document.export();
  const bus = document.find('buses', 1)!;
  expect(() => document.edit(tx => {
    tx.update(bus, { name: 'Should roll back' });
    tx.addBus({ number: 2, class: 'Bus', name: 'Duplicate', params: {} });
  })).toThrow('Duplicate');
  expect(document.export()).toEqual(before);
  expect(document.find('buses', 1)).toEqual(bus);
  expect(() => document.edit(tx => tx.update(bus, { params: { kv: Infinity } }))).toThrow();
  expect(() => document.edit(tx => tx.addDevice({ class: 'Branch', id: 'bad', ports: { bus1: bus, bus2: { collection: 'buses', id: 'missing' } }, params: {} }))).toThrow('Invalid target');
  expect(document.export()).toEqual(before);
});

it('does not bind ambiguous imports or invent meanings for unknown device ports', () => {
  const value = input();
  const document = new CaseDocument({ ...value, buses: [value.buses[0]!, ...value.buses] });
  expect(document.find('buses', 1)).toBeUndefined();
  expect(document.rows('devices')[0]!.value.ports.bus1).toBe(1);
  expect(document.rows('devices')[1]!.value.ports.input).toBe(0);
  expect(() => document.connection('Branch', 'bus1', 1)).toThrow('unambiguous');
});

it('rejects expired, nested and asynchronous transactions', () => {
  const document = new CaseDocument(input());
  let captured!: Transaction;
  document.edit(tx => { captured = tx; });
  expect(() => captured.addBus({ number: 8, class: 'Bus', name: '', params: {} })).toThrow('finished');
  expect(() => document.edit(() => document.edit(() => {}))).toThrow('Nested');
  expect(() => document.edit(async tx => { await Promise.resolve(); tx.details({ case_name: 'Late', case_description: '', case_comments: '', freq_base: 50, va_base: 1 }); })).toThrow('synchronous');
  expect(document.info.header.case_name).toBe(fixture.header.case_name);
});

it('records only touched elements and preserves typed JSON', () => {
  const document = new CaseDocument(input());
  const untouched = document.rows('buses')[1]!;
  const data = { kv: 230, number: 12, text: '12', flag: true, nested: { a: [1, 'two', null] } };
  const ref = document.rows('buses')[0]!.ref, wiring = document.wiring;
  const changes = document.edit(tx => tx.update(ref, { params: data }))!;
  expect(changes.elements).toHaveLength(1);
  expect(document.get(untouched.ref)).toBe(untouched);
  expect(Object.isFrozen(document.get(ref)!.value.params.nested)).toBe(true);
  expect(document.edit(tx => tx.update(ref, { params: data }))).toBeNull();
  // Only what changes how the case is built changes its wiring.
  expect(document.wiring).toBe(wiring);
  document.edit(tx => tx.connect({ element: document.find('devices', 'line-1')!, port: 'bus2' }, ref));
  expect(document.wiring).toBe(wiring + 1);
});

it('reads past metadata it does not know, and rejects duplicate stable IDs', () => {
  const saved = new CaseDocument(input()).export();
  expect(() => new CaseDocument({ ...saved, buses: [...saved.buses, saved.buses[0]!] })).toThrow('Duplicate editor identity');
  const later = new CaseDocument({ ...saved, buses: [{ ...saved.buses[0]!, $editor: { version: 2, id: 'future', layers: [] } }] });
  expect(later.rows('buses')[0]!.ref.id).toBe('future');
});

it('cascades through staged connections without deleting devices reconnected away', () => {
  const document = new CaseDocument(input());
  const north = document.find('buses', 1)!, south = document.find('buses', 2)!;
  const branch = document.find('devices', 'line-1')!;
  const before = document.export();
  const changes = document.edit(tx => {
    tx.connect({ element: branch, port: 'bus1' }, south);
    tx.addDevice({ class: 'Branch', id: 'temporary', ports: { bus1: north, bus2: south }, params: {} });
    tx.remove([north], { connected: 'cascade' });
  })!;
  expect(document.get(branch)).toBeDefined();
  expect(document.find('devices', 'temporary')).toBeUndefined();
  expect(document.get(north)).toBeUndefined();
  document.apply(changes, 'backward');
  expect(document.export()).toEqual(before);
});

it('preserves explicit signal references on custom devices and arbitrary native class/port names', () => {
  const document = new CaseDocument(input());
  const signal = document.find('signals', 0)!;
  document.edit(tx => {
    tx.addDevice({ class: 'Controller', id: 'controller', ports: { input: signal }, params: {} });
    tx.addDevice({ class: 'constructor', id: 'custom', ports: { toString: 42 }, params: {} });
  });
  document.edit(tx => tx.update(signal, { signal_id: 10 }));
  const saved = document.export();
  const restored = new CaseDocument(saved);
  expect(restored.get(restored.find('devices', 'controller')!)!.value.ports.input).toEqual(signal);
  expect(restored.get(restored.find('devices', 'custom')!)!.value.ports.toString).toBe(42);
  expect(restored.export()).toEqual(saved);
});
