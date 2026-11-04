import { expect, it } from 'vitest';
import { field } from 'latkit';
import fixture from '../../../library/test/small.case.json';
import { CaseDocument, parseCase } from '@gridkit/library';
import { createEditor } from '../app/case-editor.svelte.js';
import { defaultMarks, editCase, mappingDraft, recognize } from '../domain/views.js';
import { resolveMappings } from './resolve.js';
import { simulationFields } from '../simulation/sampled.js';

const bus = { mark: 'buses' } as const;
const target = { collection: 'buses', class: 'Bus' } as const;
const input = () => parseCase(JSON.stringify(fixture));

it('applies the final mapping draft atomically and retains unrelated case edits', () => {
  const editor = createEditor(); editor.open(input());
  const draft = mappingDraft(editor.views, defaultMarks);
  draft.map(bus, 'radius', 6);
  draft.map(bus, 'radius', 9);
  expect(editor.views).toEqual({});
  const ref = editor.document.rows('buses')[0]!.ref;
  editor.edit('Rename bus', tx => tx.update(ref, { name: 'Kept' }));
  editor.edit('Apply mappings', tx => tx.apply(draft.changes));
  const saved = editor.views;
  expect(resolveMappings(defaultMarks(), undefined, saved.network, target => editor.document.fields(target)).marks.find(mark => mark.id === 'buses')?.options).toMatchObject({ radius: 9 });
  editor.undo();
  expect(editor.views.network).toBeUndefined();
  expect(editor.document.get(ref)!.value.name).toBe('Kept');
  editor.redo();
  expect(editor.views).toEqual(saved);
});

it('rejects stale mapping drafts without committing other staged changes', () => {
  const editor = createEditor(); editor.open(input());
  const draft = mappingDraft(editor.views, defaultMarks);
  draft.map(bus, 'radius', 8);
  editor.edit('Change mappings', tx => tx.map(bus, 'radius', 7));
  const before = editor.snapshot().value;
  const ref = editor.document.rows('buses')[0]!.ref;
  expect(() => editor.edit('Apply stale draft', tx => {
    tx.update(ref, { name: 'Must not apply' });
    tx.apply(draft.changes);
  })).toThrow('Mappings changed');
  expect(editor.snapshot().value).toEqual(before);
});

it('keeps absent resets as no-ops and equal explicit values as overrides', () => {
  const draft = mappingDraft({}, defaultMarks);
  draft.reset(bus, 'radius');
  draft.removeMark({ mark: 'missing' });
  expect(draft.value).toEqual({});
  draft.map(bus, 'radius', 5);
  const resolved = resolveMappings(defaultMarks(), undefined, draft.value.network, () => []);
  expect(resolved.marks.find(mark => mark.id === 'buses')?.options).toMatchObject({ radius: 5 });
});

it('stores native expressions, publishes only scene changes, and restores them through history and files', () => {
  const editor = createEditor(); editor.open(input());
  const content = editor.caseVersion;
  editor.edit('Map voltage', tx => {
    tx.map(bus, 'color', field('params.kv').colormap('viridis'));
    tx.map(bus, 'radius', field('params.kv').scale(3, 12).domain(69, 765));
    tx.map(bus, 'label', { text: field('number') });
  });
  expect(editor.caseVersion).toBe(content);
  expect(editor.changed).toBe(true);
  const saved = JSON.parse(JSON.stringify(editor.views));
  expect(saved.network.marks.find((mark: { id: string }) => mark.id === 'buses').options).toEqual({
    color: { colormap: 'viridis', value: '$params.kv' },
    radius: { scale: [3, 12], value: '$params.kv', domain: [69, 765] }, label: { text: '$number' },
  });
  expect(new CaseDocument(parseCase(JSON.stringify(editor.snapshot().value))).views).toEqual(saved);
  editor.undo(); expect(editor.views).toEqual({}); expect(editor.changed).toBe(false);
  editor.redo(); expect(editor.views).toEqual(saved);
});

it('keeps null, reset, compound values and ordered duplicate representations distinct', () => {
  const document = new CaseDocument(input());
  const user = mappingDraft({}, defaultMarks);
  user.map(bus, 'radius', field('params.kv').scale(2, 9).domain(0, 500));
  user.map(bus, 'label', { text: field('number') });
  editCase(document, tx => {
    tx.map(bus, 'radius', 7);
    tx.map(bus, 'label', null);
    tx.addMark({ id: 'voltage-ring', target, kind: 'vertices', options: { ring: field('init.Vr').colormap('viridis') } }, { after: 'buses' });
  });
  const resolve = () => resolveMappings(defaultMarks(), user.value.network, document.views.network, target => document.fields(target));
  expect(resolve().marks.map(mark => mark.id)).toEqual(['branches', 'buses', 'voltage-ring']);
  expect(resolve().marks[1]?.options).toMatchObject({ radius: 7, label: null });
  editCase(document, tx => { tx.reset(bus, 'radius'); tx.map(bus, 'label', { text: field('name') }); });
  expect(resolve().marks[1]?.options).toMatchObject({ radius: { scale: [2, 9], value: '$params.kv' }, label: { text: '$name' } });
  expect(resolve().marks[1]?.options.label).not.toHaveProperty('max');
});

it('tracks field presence and mixed kinds through edits and undo without losing absent schema fields', () => {
  const document = new CaseDocument(input()), row = document.rows('buses')[0]!;
  const before = document.fields(target).find(field => field.id === 'params.kv')!;
  const schema = document.schema, fields = document.fields(target);
  editCase(document, tx => tx.update(row.ref, { params: { ...row.value.params, kv: 345 } }));
  expect(document.schema).toBe(schema);
  expect(document.fields(target)).toBe(fields);
  const changed = editCase(document, tx => tx.update(row.ref, { params: { ...row.value.params, kv: 500, imported: 'text' } }))!;
  expect(document.fields(target).find(field => field.id === 'params.imported')).toMatchObject({ kind: 'text', presence: { present: 1, total: 2 } });
  expect(document.schema).toBeGreaterThan(schema);
  document.apply(changed, 'backward');
  expect(document.fields(target).find(field => field.id === 'params.imported')).toBeUndefined();
  expect(document.fields(target).find(field => field.id === 'params.kv')).toEqual(before);
  expect(document.fields(target).find(field => field.id === 'placement.network.x')).toMatchObject({ kind: 'number', presence: { present: 0, total: 2 } });
  const mixed = new CaseDocument({ ...input(), buses: input().buses.map((bus, index) => ({ ...bus, params: { kv: index ? 'unknown' : 230 } })) });
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
  // An output no run records is still reported, while results play.
  const unknown = { marks: [{ id: 'buses', target, kind: 'vertices', options: { radius: '$simulation.nope~change' } }] };
  expect(resolveMappings(defaultMarks(), undefined, unknown, fields, true).diagnostics[0]).toMatchObject({ code: 'missing-field' });
});

it('rejects structural overrides and incomplete position pairs atomically', () => {
  expect(recognize(field('params.kv').add(3).toJSON()).kind).toBe('expression');
  const document = new CaseDocument(input()), before = document.export();
  expect(() => editCase(document, tx => {
    tx.map(bus, 'radius', 7);
    // @ts-expect-error An incomplete pair must fail at runtime too.
    tx.map(bus, 'position', [field('number')]);
  })).toThrow('pair');
  expect(document.export()).toEqual(before);
  expect(() => editCase(document, tx => {
    // @ts-expect-error Structure is catalog-owned.
    tx.map(bus, 'vertices', ['other', 'table']);
  })).toThrow('structural');
});
