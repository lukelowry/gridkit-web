import { expect, it } from 'vitest';
import { createCase, parseCase } from '@gridkit/library';
import { createEditor } from './case-editor.svelte.js';
import fixture from '../../../library/test/small.case.json';

it('opens an immutable production case and preserves native data in exports', () => {
  const input = parseCase(JSON.stringify(fixture));
  const editor = createEditor(input);
  expect(editor.info).toBe(editor.document.info);
  expect(editor.document.size).toBe(input.buses.length + input.devices.length + (input.signals?.length ?? 0));
  expect(editor.snapshot().value).toMatchObject(input);
  const bus = editor.document.find('buses', 1)!;
  expect(editor.document.get(bus)?.value).toMatchObject({ name: 'North', number: 1 });
  expect(editor.snapshot().value.devices[0]!.ports).toEqual({ bus1: 1, bus2: 2 });
});

it('gives separate opened cases distinct run identities without changing previous snapshots', () => {
  const first = createEditor(parseCase(JSON.stringify(fixture))), saved = first.snapshot();
  const second = createEditor(createCase());
  expect(second.caseVersion).not.toBe(first.caseVersion);
  expect(second.document).not.toBe(first.document);
  expect(second.info.header.case_name).toBe('Untitled');
  expect(second.document.size).toBe(0);
  expect(first.snapshot()).toEqual(saved);
  expect(first.info.header.case_name).toBe(fixture.header.case_name);
});

it('preserves imported visual metadata without adding editing or history APIs', () => {
  const views = { network: { space: 'plane' } };
  const editor = createEditor(parseCase(JSON.stringify({ ...fixture, $editor: { views } })));
  expect(editor.document.views).toEqual({ network: views.network });
  expect(editor.snapshot().value.$editor).toMatchObject({ views });
  for (const property of ['edit', 'undo', 'redo', 'open', 'changed', 'canUndo', 'canRedo', 'markExported'])
    expect(editor).not.toHaveProperty(property);
});
