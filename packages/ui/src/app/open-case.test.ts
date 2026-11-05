import { expect, it } from 'vitest';
import { createCase, parseCase } from '@gridkit/library';
import { openCase } from './open-case.svelte.js';
import fixture from '../../../library/test/small.case.json';

it('opens an immutable production case and preserves native data in exports', () => {
  const input = parseCase(JSON.stringify(fixture));
  const current = openCase(input);
  expect(current.info).toBe(current.document.info);
  expect(current.document.size).toBe(input.buses.length + input.devices.length + (input.signals?.length ?? 0));
  expect(current.snapshot().value).toMatchObject(input);
  const bus = current.document.find('buses', 1)!;
  expect(current.document.get(bus)?.value).toMatchObject({ name: 'North', number: 1 });
  expect(current.snapshot().value.devices[0]!.ports).toEqual({ bus1: 1, bus2: 2 });
});

it('gives separate opened cases distinct run identities without changing previous snapshots', () => {
  const first = openCase(parseCase(JSON.stringify(fixture))), saved = first.snapshot();
  const second = openCase(createCase());
  expect(second.caseVersion).not.toBe(first.caseVersion);
  expect(second.document).not.toBe(first.document);
  expect(second.info.header.case_name).toBe('Untitled');
  expect(second.document.size).toBe(0);
  expect(first.snapshot()).toEqual(saved);
  expect(first.info.header.case_name).toBe(fixture.header.case_name);
});

it('preserves imported visual metadata without adding editing or history APIs', () => {
  const views = { network: { space: 'plane' } };
  const current = openCase(parseCase(JSON.stringify({ ...fixture, $ui: { views } })));
  expect(current.document.views).toEqual({ network: views.network });
  expect(current.snapshot().value.$ui).toMatchObject({ views });
  for (const property of ['edit', 'undo', 'redo', 'open', 'changed', 'canUndo', 'canRedo', 'markExported'])
    expect(current).not.toHaveProperty(property);
});
