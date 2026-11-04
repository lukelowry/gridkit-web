import { expect, it } from 'vitest';
import fixture from '../../../library/test/small.case.json';
import { CaseDocument, createCase, parseCase, type ElementRef } from '@gridkit/library';
import { createEditor } from '../app/case-editor.svelte.js';
import { createElementDraft, submitElementDraft, DraftError, type ElementRequest } from './draft.js';
import { editCase } from '../domain/views.js';

it('connects named ports from a property draft in one reversible transaction', () => {
  const editor = createEditor();
  editor.edit('Add models', tx => { tx.add('ConstantSignalSource'); tx.add('Ieeet1'); });
  const [source, target] = editor.document.rows('devices');
  const request = { ref: target!.ref }, draft = createElementDraft(editor.document, request);
  const port = draft.ports.find(port => port.key === 'vref')!;
  const choice = [...port.choices!.byId.values()].find(choice => 'element' in choice.connection && choice.connection.element.id === source!.ref.id && choice.connection.port === 'sr')!;
  expect(choice).toBeDefined();
  port.text = choice.id;
  const submission = submitElementDraft(editor.document, request, draft);
  expect(editor.document.rows('signals')).toHaveLength(0);
  editor.edit('Connect', tx => {
    tx.update(submission.ref, submission.changes);
    for (const connection of submission.connections) tx.connect({ element: submission.ref, port: connection.port }, connection.to);
  });
  const saved = editor.snapshot().value;
  expect(saved.signals).toHaveLength(1);
  expect(saved.devices[0]!.ports.sr).toBe(saved.devices[1]!.ports.vref);
  const output = createElementDraft(editor.document, { ref: source!.ref }).ports.find(port => port.key === 'sr')!;
  expect([...output.choices!.byId.values()].some(choice => 'element' in choice.connection && choice.connection.port === 'efd')).toBe(false);
  editor.undo();
  expect(editor.document.rows('signals')).toHaveLength(0);
  expect(editor.snapshot().value.devices.every(device => Object.keys(device.ports).length === 0)).toBe(true);
  editor.redo();
  expect(editor.snapshot().value).toEqual(saved);
});

it('keeps a connected network through renumbering, history and reopening', () => {
  const editor = createEditor();
  let a!: ElementRef, branch!: ElementRef;
  editor.edit('Draw branch', tx => {
    a = tx.add('Bus'); branch = tx.add('Branch');
    tx.connect({ element: branch, port: 'bus1' }, a);
    tx.connect({ element: branch, port: 'bus2' }, tx.add('Bus'));
  });
  expect(editor.document.dependents(a)).toEqual([branch]);
  editor.edit('Renumber bus', tx => tx.update(a, { number: 40 }));
  expect(editor.snapshot().value.devices[0]!.ports.bus1).toBe(40);
  const snapshot = editor.snapshot().value;
  editor.edit('Delete', tx => tx.remove([a], { connected: 'cascade' }));
  expect(editor.document.get(branch)).toBeUndefined();
  editor.undo();
  expect(editor.snapshot().value).toEqual(snapshot);
  const reopened = new CaseDocument(snapshot);
  expect(reopened.find('buses', 40)).toEqual(a);
  expect(reopened.dependents(a)).toEqual([branch]);
});

it('reports field errors without mutating the document, including duplicate identifiers and invalid impedance', () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)));
  const before = document.export();
  const request: ElementRequest = { ref: document.find('devices', 'line-1')! };
  const draft = createElementDraft(document, request);
  draft.identifier = 'future-1';
  draft.ports.forEach(port => { port.text = ''; });
  draft.params!.find(field => field.key === 'R')!.text = '0';
  draft.params!.find(field => field.key === 'X')!.text = '0';
  try { submitElementDraft(document, request, draft); throw new Error('Expected validation'); }
  catch (error) {
    expect(error).toBeInstanceOf(DraftError);
    expect(Object.keys((error as DraftError).issues)).toEqual(expect.arrayContaining(['identifier', 'params.R', 'params.X']));
  }
  const bus = document.find('buses', 1)!;
  expect(() => editCase(document, tx => tx.addDevice({ class: 'Branch', id: 'new', ports: { bus1: bus, bus2: bus }, params: { R: 0, X: 0 } }))).toThrow('both be zero');
  expect(() => editCase(document, tx => tx.addDevice({ class: 'Branch', id: 'new', ports: { bus1: bus, bus2: bus }, params: { R: 0, X: 1, tap: 0 } }))).toThrow('greater than zero');
  expect(document.export()).toEqual(before);
  expect(new CaseDocument(createCase()).suggestIdentifier('buses')).toBe(1);
});

it('edits unfinished imports without filling defaults, losing custom data, or rewriting unresolved ports', () => {
  const input = parseCase(JSON.stringify(fixture));
  const document = new CaseDocument({ ...input, devices: [{ ...input.devices[0]!, params: { R: 0.1, custom: [1, true] }, ports: { bus1: 99, bus2: 2 } }] });
  const ref = document.rows('devices')[0]!.ref;
  const request: ElementRequest = { ref };
  const draft = createElementDraft(document, request);
  draft.identifier = 'renamed';
  const result = submitElementDraft(document, request, draft);

  editCase(document, tx => tx.update(result.ref, result.changes));
  expect(document.export().devices[0]).toMatchObject({ id: 'renamed', params: { R: 0.1, custom: [1, true] }, ports: { bus1: 99, bus2: 2 } });
  expect(document.export().devices[0]!.params).not.toHaveProperty('tap');
});

it('rejects clearing reactance when its native default would invalidate the branch', () => {
  const input = parseCase(JSON.stringify(fixture));
  const document = new CaseDocument({ ...input, devices: [{ ...input.devices[0]!, params: { R: 0, X: 0.1 } }] });
  const request = { ref: document.rows('devices')[0]!.ref };
  const draft = createElementDraft(document, request), before = document.export();
  draft.params!.find(field => field.key === 'X')!.text = '';
  expect(() => submitElementDraft(document, request, draft)).toThrow(DraftError);
  expect(() => editCase(document, tx => tx.update(request.ref, { params: { R: 0 } }))).toThrow('both be zero');
  expect(document.export()).toEqual(before);

  draft.params!.find(field => field.key === 'R')!.text = '0.1';
  const result = submitElementDraft(document, request, draft);
  editCase(document, tx => tx.update(result.ref, result.changes));
  expect(document.export().devices[0]!.params).toEqual({ R: 0.1 });
});
