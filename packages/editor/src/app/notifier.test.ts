import { expect, it, vi } from 'vitest';
import fixture from '../../../library/test/small.case.json';
import { CaseDocument, parseCase } from '@gridkit/library';
import { editCase } from '../domain/views.js';
import { Notifier } from './notifier.svelte.js';

/** Whether `change` tells what `read` watched. Effects run in the browser's Svelte, and only there. */
function told(read: () => void, change: () => void) {
  const track = vi.spyOn(Notifier.prototype, 'track'), notify = vi.spyOn(Notifier.prototype, 'notify');
  read();
  const watched = new Set(track.mock.contexts);
  expect(watched.size).toBeGreaterThan(0);
  change();
  const result = notify.mock.contexts.some(notifier => watched.has(notifier));
  track.mockRestore(); notify.mockRestore();
  return result;
}

it('tells each reader of a document only about what it reads', () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)), () => new Notifier()), row = document.rows('buses')[0]!;
  let kv = 300;
  const editValue = () => { editCase(document, tx => tx.update(row.ref, { params: { ...row.value.params, kv: kv++ } })); };
  const mapRadius = () => { editCase(document, tx => tx.map({ mark: 'buses' }, 'radius', kv++)); };
  expect(told(() => document.rows('buses'), editValue)).toBe(true);
  expect(told(() => document.get(row.ref), editValue)).toBe(true);
  expect(told(() => document.size, editValue)).toBe(true);
  // A value changes neither how the case is built nor which fields it has, nor its views: a scene waits on those alone.
  expect(told(() => document.schema, editValue)).toBe(false);
  expect(told(() => document.targets, editValue)).toBe(false);
  expect(told(() => document.fields({ collection: 'buses' }), editValue)).toBe(false);
  expect(told(() => document.wiring, editValue)).toBe(false);
  expect(told(() => document.numbering, editValue)).toBe(false);
  expect(told(() => document.views, editValue)).toBe(false);
  expect(told(() => document.schema, () => { editCase(document, tx => tx.update(row.ref, { params: { ...row.value.params, imported: 'text' } })); })).toBe(true);
  expect(told(() => document.numbering, () => { editCase(document, tx => tx.update(row.ref, { number: 77 })); })).toBe(true);
  expect(told(() => document.wiring, () => { editCase(document, tx => { tx.remove([document.rows('devices')[0]!.ref], { connected: 'cascade' }); }); })).toBe(true);
  expect(told(() => document.views, mapRadius)).toBe(true);
  expect(told(() => document.rows('buses'), mapRadius)).toBe(false);
});

it('tells readers on undo as on an edit', () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)), () => new Notifier()), row = document.rows('buses')[0]!;
  const changes = editCase(document, tx => tx.update(row.ref, { params: { ...row.value.params, kv: 345 } }))!;
  expect(told(() => document.rows('buses'), () => document.apply(changes, 'backward'))).toBe(true);
});
