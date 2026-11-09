import { expect, it, vi } from 'vitest';
import { CaseDocument, parseCase } from '@gridkit/library';
import { entriesOf } from '../domain/entries.js';
import { classesOf, classKey, columnsOf, tableSource } from '../table/rows.js';
import { tables } from '../rendering/data.js';
import { createPreferences } from './state.svelte.js';
import fixture from '../../../library/test/small.case.json';

it('keeps preference drafts local until Apply and persists mappings once', () => {
  let stored = '{}';
  const save = vi.fn((_key: string, value: string) => { stored = value; });
  vi.stubGlobal('localStorage', { getItem: () => stored, setItem: save });
  try {
    const preferences = createPreferences();
    const draft = createPreferences(preferences.serialize());
    draft.set('theme', 'dark');
    draft.editMappings(tx => tx.map({ mark: 'buses' }, 'radius', 8));
    expect(save).not.toHaveBeenCalled();
    expect(preferences.value.theme).toBe('system');
    expect(preferences.mappings).toEqual({});
    preferences.apply(draft.serialize());
    expect(save).toHaveBeenCalledTimes(1);
    const restored = createPreferences();
    expect(restored.value.theme).toBe('dark');
    expect(restored.mappings).toEqual(draft.mappings);
  } finally { vi.unstubAllGlobals(); }
});

it('keeps valid preferences and drops the rest', () => {
  const stored = { theme: 'dark', networkGrid: false, pickRadius: 12, wheel: 'invalid', unknown: true,
    mappings: { network: { theme: { vertex: { radius: 8 } } } } };
  const preferences = createPreferences(JSON.stringify(stored));
  expect(preferences.value).toMatchObject({ theme: 'dark', networkGrid: false, pickRadius: 12, wheel: 'wheel' });
  const saved = JSON.parse(preferences.serialize());
  expect(saved).not.toHaveProperty('unknown');
  expect(saved.mappings).toEqual(stored.mappings);
  const restored = createPreferences(preferences.serialize());
  expect(restored.value.pickRadius).toBe(12);
  restored.reset('pickRadius');
  expect(restored.value.pickRadius).toBe(6);
  expect(() => restored.set('pickRadius', -1)).toThrow();
});

it('draws every bus class in one table and leaves device references native', () => {
  const value = parseCase(JSON.stringify({ ...fixture, buses: [fixture.buses[0], { ...fixture.buses[1], class: 'PQBus' }] }));
  const document = new CaseDocument(value), drawn = tables(document);
  expect(drawn.get('Bus')!.map(row => row.ref)).toEqual(document.rows('buses').map(row => row.ref));
  expect(drawn.get('Branch')!.map(row => row.ref)).toEqual([document.rows('devices')[0]!.ref]);
  expect([...drawn.keys()]).toEqual(['Bus', 'Signal', 'Branch']);
  expect(document.fields({ collection: 'buses', class: 'PQBus' }).map(field => field.id)).toContain('params.kv');
  expect(document.export().devices[0]!.ports).toEqual({ bus1: 1, bus2: 2 });
});

it('filters classes without collisions and sorts native parameter columns numerically', () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)));
  const rows = entriesOf(document);
  const buses = rows.filter(row => row.collection === 'buses');
  const columns = columnsOf(buses, classKey(buses[0]!), document.fields(buses[0]!));
  expect(columns.some(column => column.key === 'params.kv')).toBe(true);
  const source = tableSource(rows.filter(row => row.class === 'Branch'), [{ key: 'params.R', label: 'R', width: 120 }]);
  expect(source.window('', { column: 0, dir: 'asc' }, 0, 10)).toMatchObject({ rows: [{ label: 'line-1', cells: ['0.01'] }] });
  expect(classesOf([...rows, { ...rows[0]!, collection: 'devices' }]).filter(item => item.label === 'Bus')).toHaveLength(2);
});
