import { expect, it } from 'vitest';
import { createCase, detailsOf, parseCase, type ElementRef } from '@gridkit/library';
import { createEditor } from './case-editor.svelte.js';
import fixture from '../../../library/test/small.case.json';

it('tracks saved revisions through undo, redo, branching, and delayed exports', () => {
  const editor = createEditor();
  editor.open(createCase());
  editor.edit('Rename', tx => tx.details({ ...detailsOf(editor.info), case_name: 'Edited' }));
  const saved = editor.snapshot();
  editor.markExported(saved);
  expect(editor.changed).toBe(false);
  editor.undo();
  expect(editor.info.header.case_name).toBe('Untitled');
  expect(editor.changed).toBe(true);
  editor.redo();
  expect(editor.info.header.case_name).toBe('Edited');
  expect(editor.changed).toBe(false);
  editor.undo();
  editor.edit('Different name', tx => tx.details({ ...detailsOf(editor.info), case_name: 'Different' }));
  editor.markExported(saved);
  expect(editor.changed).toBe(true);
  expect(editor.canRedo).toBe(false);
  editor.open(createCase());
  editor.markExported(saved);
  expect(editor.changed).toBe(false);
});

it('does not record no-op, cancelled, or failed transactions', () => {
  const editor = createEditor();
  editor.edit('No change', tx => tx.details(detailsOf(editor.info)));
  expect(editor.canUndo).toBe(false);
  expect(() => editor.edit('Failed', tx => {
    tx.details({ ...detailsOf(editor.info), case_name: 'Should not persist' });
    tx.addBus({ number: 1, class: 'Bus', name: 'One', params: {} });
    throw new Error('Cancelled');
  })).toThrow('Cancelled');
  expect(editor.document.size).toBe(0);
  expect(editor.info.header.case_name).toBe('Untitled');
  expect(editor.changed).toBe(false);
  editor.edit('Rename', tx => tx.details({ ...detailsOf(editor.info), case_name: 'Changed' }));
  editor.undo();
  editor.edit('No change', () => {});
  expect(editor.canRedo).toBe(true);
});

it('resets history on open and bounds it by transactions', () => {
  const editor = createEditor();
  for (let index = 1; index <= 60; index++) {
    editor.edit('Rename', tx => tx.details({ ...detailsOf(editor.info), case_name: String(index) }));
  }
  let undone = 0;
  while (editor.canUndo) { editor.undo(); undone++; }
  expect(undone).toBe(50);
  expect(editor.info.header.case_name).toBe('10');
  while (editor.canRedo) editor.redo();
  expect(editor.info.header.case_name).toBe('60');
  editor.open(createCase());
  expect(editor.canUndo || editor.canRedo || editor.changed).toBe(false);
});

it('adds, connects and deletes as atomic transactions with stable identities', () => {
  const editor = createEditor();
  editor.open(parseCase(JSON.stringify(fixture)));
  const original = editor.snapshot().value;
  const first = editor.document.find('buses', 1)!;
  let bus!: ElementRef<'buses'>, branch!: ElementRef<'devices'>;
  editor.edit('Extend network', tx => {
    bus = tx.addBus({ number: 3, class: 'Bus', name: 'Three', params: { kv: 230 } });
    branch = tx.addDevice({ class: 'Branch', id: 'line-2', ports: { bus1: first, bus2: bus }, params: { R: 0.01, X: 0.1 } });
  });
  const extended = editor.snapshot().value;
  expect(editor.undoLabel).toBe('Extend network');
  expect(extended.devices.at(-1)!.ports).toEqual({ bus1: 1, bus2: 3 });
  editor.undo();
  expect(editor.snapshot().value).toEqual(original);
  expect(editor.document.get(bus)).toBeUndefined();
  editor.redo();
  expect(editor.snapshot().value).toEqual(extended);
  expect(() => editor.edit('Delete bus', tx => tx.remove([bus]))).toThrow('connected');
  expect(editor.document.get(bus)).toBeDefined();
  editor.edit('Delete bus and devices', tx => tx.remove([bus], { connected: 'cascade' }));
  expect(editor.document.get(bus)).toBeUndefined();
  expect(editor.document.get(branch)).toBeUndefined();
  editor.undo();
  expect(editor.snapshot().value).toEqual(extended);
});

it('versions the content a run\'s results belong to by element changes, not case information', () => {
  const editor = createEditor();
  editor.open(parseCase(JSON.stringify(fixture)));
  const before = { content: editor.caseVersion };
  editor.edit('Rename case', tx => tx.details({ ...detailsOf(editor.info), case_name: 'Name' }));
  expect(editor.caseVersion).toBe(before.content);
  const bus = editor.document.find('buses', 1)!;
  editor.edit('Renumber', tx => tx.update(bus, { number: 7 }));
  expect(editor.caseVersion).toBe(before.content + 1);
  expect(editor.snapshot().value.devices[0]!.ports.bus1).toBe(7);
  editor.undo();
  expect(editor.caseVersion).toBe(before.content + 2);
});
