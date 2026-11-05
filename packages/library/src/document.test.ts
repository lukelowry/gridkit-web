import { expect, it } from 'vitest';
import fixture from '../test/small.case.json';
import { createCase, parseCase, serializeCase } from './case.js';
import { CaseDocument } from './document.js';

const input = () => parseCase(JSON.stringify(fixture));

it('shares deeply immutable imported parameters and extras through export', () => {
  const value = input(), document = new CaseDocument(value);
  const bus = document.find('buses', 1)!;
  expect(document.info.header).toBe(value.header);
  expect(document.info.params).toBe(value.params);
  expect(document.get(bus)!.value.params).toBe(value.buses[0]!.params);
  const saved = document.export();
  expect(saved.buses[0]!.params).toBe(value.buses[0]!.params);
  expect(saved.devices[0]!.params).toBe(value.devices[0]!.params);
  expect(saved.extension).toBe(value.extension);
  expect(Object.isFrozen(document.get(bus))).toBe(true);
  expect(Object.isFrozen(document.get(bus)!.value.params)).toBe(true);
  expect(() => Object.assign(document.get(bus)!.value.params, { kv: 1 })).toThrow();
  expect(document).not.toHaveProperty('edit');
  expect(document).not.toHaveProperty('apply');
});

it('freezes nested imported data even when its parent was already shallowly frozen', () => {
  const value = input(), nested = Object.freeze({ child: { value: 1 } });
  const document = new CaseDocument({ ...value, buses: [{ ...value.buses[0]!, params: { nested } }] });
  expect(document.rows('buses')[0]!.value.params.nested).toBe(nested);
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

it('indexes native identifiers, storage order and incoming connections without altering them', () => {
  const document = new CaseDocument(input());
  const north = document.find('buses', 1)!, south = document.find('buses', 2)!, branch = document.find('devices', 'line-1')!;
  expect(document.size).toBe(5);
  expect(document.rows('buses').map(row => row.value.number)).toEqual([1, 2]);
  expect(document.get(branch)!.value.ports).toEqual({ bus1: north, bus2: south });
  expect(document.dependents(north)).toEqual([branch]);
  expect(document.dependents({ collection: 'buses', id: 'missing' })).toEqual([]);
  expect(document.get({ collection: 'devices', id: north.id })).toBeUndefined();
  expect(document.number(north)).toBe(1);
  expect(document.number(-12)).toBe(-12);
  expect(() => document.number(branch)).toThrow('bus or signal');
  expect(() => document.number({ collection: 'buses', id: 'missing' })).toThrow('missing');
  expect(document.identifierTaken('buses', 1, north)).toBe(false);
  expect(document.identifierTaken('buses', 1)).toBe(true);
  expect(document.export().devices[0]!.ports).toEqual({ bus1: 1, bus2: 2 });
});

it('does not bind ambiguous imports or invent meanings for unknown device ports', () => {
  const value = input();
  const document = new CaseDocument({ ...value, buses: [value.buses[0]!, ...value.buses] });
  expect(document.find('buses', 1)).toBeUndefined();
  expect(document.rows('devices')[0]!.value.ports.bus1).toBe(1);
  expect(document.rows('devices')[1]!.value.ports.input).toBe(0);
  expect(document.identifierTaken('buses', 1, document.rows('buses')[0]!.ref)).toBe(true);
});

it('reads past metadata it does not know, and rejects duplicate stable IDs', () => {
  const saved = new CaseDocument(input()).export();
  expect(() => new CaseDocument({ ...saved, buses: [...saved.buses, saved.buses[0]!] })).toThrow('Duplicate editor identity');
  const later = new CaseDocument({ ...saved, buses: [{ ...saved.buses[0]!, $editor: { version: 2, id: 'future', layers: [] } }] });
  expect(later.rows('buses')[0]!.ref.id).toBe('future');
});

it('preserves explicit signal references on custom devices and arbitrary native class/port names', () => {
  const value = input();
  const document = new CaseDocument({ ...value,
    signals: [{ signal_id: 10, name: 'Control', $editor: { id: 'control' } }],
    devices: [
      { class: 'Controller', id: 'controller', ports: { input: 10 }, params: {}, $editor: { id: 'controller-id', ports: { input: { collection: 'signals', id: 'control' } } } },
      { class: 'constructor', id: 'custom', ports: { toString: 42 }, params: {} },
    ],
  });
  const saved = document.export(), restored = new CaseDocument(saved);
  expect(restored.get(restored.find('devices', 'controller')!)!.value.ports.input).toEqual({ collection: 'signals', id: 'control' });
  expect(restored.get(restored.find('devices', 'custom')!)!.value.ports.toString).toBe(42);
  expect(restored.export()).toEqual(saved);
});

it('rejects stale saved port references after external renumbering', () => {
  const saved = new CaseDocument(input()).export();
  const changed = new CaseDocument({ ...saved, buses: [{ ...saved.buses[0]!, number: 77 }, saved.buses[1]!] });
  expect(changed.rows('devices')[0]!.value.ports.bus1).toBe(1);
  expect(changed.export().devices[0]!.ports.bus1).toBe(1);
  expect(changed.dependents(changed.find('buses', 77)!)).toEqual([]);
});

it('indexes mixed field types and presence once and keeps metadata immutable', () => {
  const value = input(), document = new CaseDocument({ ...value, buses: [
    { ...value.buses[0]!, params: { kv: 230, extra: 1, flag: true } },
    { ...value.buses[1]!, params: { kv: 115, extra: 'text' } },
  ] });
  const target = { collection: 'buses', class: 'Bus' } as const, fields = document.fields(target);
  expect(fields.find(field => field.id === 'params.extra')).toMatchObject({ kind: null, presence: { present: 2, total: 2 } });
  expect(fields.find(field => field.id === 'params.flag')).toMatchObject({ kind: 'bool', presence: { present: 1, total: 2 } });
  expect(document.fields(target)).toBe(fields);
  expect(document.targets).toBe(document.targets);
  expect(Object.isFrozen(fields)).toBe(true);
  expect(Object.isFrozen(document.targets)).toBe(true);
  expect(Object.isFrozen(document.fields({ collection: 'buses' }))).toBe(true);
  expect(new CaseDocument(createCase()).fields({ collection: 'buses' }).find(field => field.id === 'params.kv')?.presence).toEqual({ present: 0, total: 0 });
});
