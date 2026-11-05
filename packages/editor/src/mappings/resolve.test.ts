import { expect, it } from 'vitest';
import { field } from 'latkit';
import fixture from '../../../library/test/small.case.json';
import { CaseDocument, parseCase } from '@gridkit/library';
import { defaultMarks, mappingDraft, recognize } from '../domain/views.js';
import { resolveMappings } from './resolve.js';
import { simulationFields } from '../simulation/sampled.js';

const bus = { mark: 'buses' } as const;
const target = { collection: 'buses', class: 'Bus' } as const;
const input = () => parseCase(JSON.stringify(fixture));

it('resolves the final visual draft without changing the opened case', () => {
  const document = new CaseDocument(input()), before = document.export();
  const draft = mappingDraft(document.views, defaultMarks);
  draft.map(bus, 'radius', 6); draft.map(bus, 'radius', 9);
  expect(resolveMappings(defaultMarks(), undefined, draft.value.network, target => document.fields(target)).marks.find(mark => mark.id === 'buses')?.options).toMatchObject({ radius: 9 });
  expect(document.views).toEqual({});
  expect(document.export()).toEqual(before);
});

it('keeps absent resets as no-ops and equal explicit values as overrides', () => {
  const draft = mappingDraft({}, defaultMarks);
  draft.reset(bus, 'radius');
  expect(draft.value).toEqual({});
  draft.map(bus, 'radius', 5);
  const resolved = resolveMappings(defaultMarks(), undefined, draft.value.network, () => []);
  expect(resolved.marks.find(mark => mark.id === 'buses')?.options).toMatchObject({ radius: 5 });
});

it('preserves imported native expressions through file export and reopening', () => {
  const views = { network: { marks: [{ id: 'buses', target, kind: 'vertices', options: {
    color: { colormap: 'viridis', value: '$params.kv' },
    radius: { scale: [3, 12], value: '$params.kv', domain: [69, 765] }, label: { text: '$number' },
  } }] } };
  const document = new CaseDocument(parseCase(JSON.stringify({ ...fixture, $editor: { views } })));
  expect(document.views).toEqual(views);
  expect(new CaseDocument(parseCase(JSON.stringify(document.export()))).views).toEqual(views);
});

it('keeps null, absent overrides, compound values and ordered duplicate representations distinct', () => {
  const user = mappingDraft({}, defaultMarks);
  user.map(bus, 'radius', field('params.kv').scale(2, 9).domain(0, 500));
  user.map(bus, 'label', { text: field('number') });
  const ring = { id: 'voltage-ring', target, kind: 'vertices', options: { ring: { colormap: 'viridis', value: '$init.Vr' } } };
  for (const [options, expected] of [
    [{ radius: 7, label: null }, { radius: 7, label: null }],
    [{ label: { text: '$name' } }, { radius: { scale: [2, 9], value: '$params.kv' }, label: { text: '$name' } }],
  ] as const) {
    const document = new CaseDocument(parseCase(JSON.stringify({ ...fixture, $editor: { views: { network: {
      marks: [...defaultMarks().map(mark => mark.id === 'buses' ? { ...mark, options } : mark), ring],
    } } } })));
    const resolved = resolveMappings(defaultMarks(), user.value.network, document.views.network, target => document.fields(target));
    expect(resolved.marks.map(mark => mark.id)).toEqual(['branches', 'buses', 'voltage-ring']);
    expect(resolved.marks[1]?.options).toMatchObject(expected);
  }
});

it('reads field presence and mixed kinds without losing absent schema fields', () => {
  const value = input(), document = new CaseDocument({ ...value, buses: value.buses.map((bus, index) => index ? bus : { ...bus, params: { ...bus.params, kv: 500, imported: 'text' } }) });
  const fields = document.fields(target);
  expect(document.fields(target)).toBe(fields);
  expect(fields.find(field => field.id === 'params.imported')).toMatchObject({ kind: 'text', presence: { present: 1, total: 2 } });
  expect(fields.find(field => field.id === 'placement.network.x')).toMatchObject({ kind: 'number', presence: { present: 0, total: 2 } });
  const mixed = new CaseDocument({ ...value, buses: value.buses.map((bus, index) => ({ ...bus, params: { kv: index ? 'unknown' : 230 } })) });
  expect(mixed.fields(target).find(field => field.id === 'params.kv')?.kind).toBeNull();
});

it('reports unknown fields and keeps the inherited value', () => {
  const document = new CaseDocument(input());
  const user = { marks: [{ id: 'buses', target, kind: 'vertices', options: { radius: 9 } }] };
  const saved = { marks: [{ id: 'buses', target, kind: 'vertices', options: { radius: '$params.missing' } }] };
  const resolved = resolveMappings(defaultMarks(), user, saved, target => document.fields(target));
  expect(resolved.diagnostics).toEqual([{ path: 'case.network.marks[0].options.radius', message: 'Unknown field: params.missing.', code: 'missing-field' }]);
  expect(resolved.marks.find(mark => mark.id === 'buses')?.options).toMatchObject({ radius: 9 });
});

it('keeps a mapping of what a run records waiting until one has results, and takes any of its measures then', () => {
  const document = new CaseDocument(input());
  const fields = (target: Parameters<ReturnType<typeof simulationFields>>[0]) => simulationFields(document)(target);
  const color = { colormap: 'rdbu', value: '$simulation.Vm~change', domain: [-0.1, 0.1] };
  const saved = { marks: [{ id: 'buses', target, kind: 'vertices', options: { color } }] };
  const waiting = resolveMappings(defaultMarks(), undefined, saved, fields);
  expect(waiting.diagnostics).toEqual([]);
  expect(waiting.marks.find(mark => mark.id === 'buses')?.options).not.toHaveProperty('color');
  const playing = resolveMappings(defaultMarks(), undefined, saved, fields, true);
  expect(playing.diagnostics).toEqual([]);
  expect(playing.marks.find(mark => mark.id === 'buses')?.options).toMatchObject({ color });
  const unknown = { marks: [{ id: 'buses', target, kind: 'vertices', options: { radius: '$simulation.nope~change' } }] };
  expect(resolveMappings(defaultMarks(), undefined, unknown, fields, true).diagnostics[0]).toMatchObject({ code: 'missing-field' });
});

it('rejects structural overrides and incomplete position pairs in visual drafts', () => {
  expect(recognize(field('params.kv').add(3).toJSON()).kind).toBe('expression');
  const draft = mappingDraft({}, defaultMarks);
  draft.map(bus, 'radius', 7);
  const before = structuredClone(draft.value);
  // @ts-expect-error An incomplete pair must fail at runtime too.
  expect(() => draft.map(bus, 'position', [field('number')])).toThrow('pair');
  // @ts-expect-error Structure is catalog-owned.
  expect(() => draft.map(bus, 'vertices', ['other', 'table'])).toThrow('structural');
  expect(draft.value).toEqual(before);
});
