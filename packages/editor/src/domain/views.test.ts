import { expect, it } from 'vitest';
import { field, when } from 'latkit';
import { CaseDocument, parseCase } from '@gridkit/library';
import { createPreferences } from '../preferences/state.svelte.js';
import fixture from '../../../library/test/small.case.json';
import { fieldsIn, mergeTheme, recognize } from './views.js';

it('reads native local fields without treating joined fields, colors, or literal text as dependencies', () => {
  const value = when(field('name').is('$literal')).then(field('params.kv'))
    .otherwise(field('value').from(['weather', 'Station'])).toJSON();
  expect(fieldsIn(value)).toEqual(['name', 'params.kv']);
  expect(fieldsIn({ field: '$internal' })).toEqual(['$internal']);
  expect(fieldsIn('rebeccapurple')).toEqual([]);
  expect(recognize(field('params.kv').scale(3, 12).toJSON())).toMatchObject({ kind: 'scale', field: 'params.kv', range: [3, 12] });
  expect(recognize('rebeccapurple')).toMatchObject({ kind: 'constant' });
});

it('stores and exports the same native mapping values through both case and browser settings', () => {
  const mappings = { network: { space: { earth: { projection: 'mercator' } },
    theme: { vertex: { radius: 7 }, text: { size: 14 } },
    marks: [{ id: 'buses', target: { collection: 'buses' }, kind: 'vertices', options: {
      radius: { units: 0.01, atMost: 7 },
      color: when(field('params.kv').gt(200)).then('#c23b36').otherwise('#356a91').toJSON(),
    } }],
  } };
  const document = new CaseDocument(parseCase(JSON.stringify({ ...fixture, $editor: { views: mappings } })));
  const preferences = createPreferences(JSON.stringify({ mappings }));
  expect(document.views).toEqual(mappings);
  expect(document.export().$editor).toEqual({ views: mappings });
  expect(JSON.parse(preferences.serialize()).mappings).toEqual(mappings);
  expect(new CaseDocument(parseCase(JSON.stringify(document.export()))).views).toEqual(mappings);
});

it('inherits nested theme groups and replaces explicit length values atomically', () => {
  expect(mergeTheme({ vertex: { color: '#123456', radius: 5 }, text: { color: '#112233', size: 12 },
    flow: { spacing: { units: 10 }, length: { units: 4 } } },
    { vertex: { radius: 7 }, text: { size: 14 }, flow: { spacing: { px: 20 }, length: { px: 10 } } }))
    .toEqual({ vertex: { color: '#123456', radius: 7 }, text: { color: '#112233', size: 14 },
      flow: { spacing: { px: 20 }, length: { px: 10 } } });
});

it('drops obsolete views on import and export while preserving Network options and case data', () => {
  const network = { futureOption: { opaque: true }, marks: [] };
  const document = new CaseDocument(parseCase(JSON.stringify({ ...fixture,
    $editor: { author: 'kept', views: { network, diagram: { marks: [] }, unsupported: {} } },
  })));
  expect(document.views).toEqual({ network });
  expect(Object.isFrozen(document.views)).toBe(true);
  const saved = document.export();
  expect(saved.$editor).toEqual({ author: 'kept', views: { network } });
  expect(saved.devices.map(row => row.ports)).toEqual(fixture.devices.map(row => row.ports));
  expect(saved.signals).toHaveLength(fixture.signals.length);
  expect(new CaseDocument(parseCase(JSON.stringify(saved))).export()).toEqual(saved);
});
