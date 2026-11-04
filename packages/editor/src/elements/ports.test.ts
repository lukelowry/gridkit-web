import { expect, it } from 'vitest';
import { CaseDocument, createCase, elementIssues, models, parseCase, type ElementRef } from '@gridkit/library';
import { createElementDraft, submitElementDraft, portRequired } from '../elements/draft.js';
import { editCase } from '../domain/views.js';

const develop = models.some(model => model.id === 'SignalVoltageIn');

it.runIf(develop)('shares signals across bus and device ports, preserves their native paths, and restores history', () => {
  const document = new CaseDocument(createCase());
  let input!: ElementRef, output!: ElementRef, source!: ElementRef;
  const changes = editCase(document, tx => {
    input = tx.add('SignalVoltageIn'); output = tx.add('SignalVoltageOut'); source = tx.add('FunctionSignalSource', { Fr: 'sin' });
    tx.connect({ element: output, port: 'vr' }, { element: input, port: 'vr' });
    tx.connect({ element: source, port: 'sr' }, { element: input, port: 'vi' });
    tx.connect({ element: input, port: 'ir' }, { element: output, port: 'ir' });
    tx.connect({ element: input, port: 'ii' }, { element: output, port: 'ii' });
  })!;
  const saved = document.export();
  expect(saved.buses[0]).toMatchObject({ class: 'SignalVoltageIn', ports_in: { vr: 0, vi: 1 }, ports_out: { ir: 2, ii: 3 } });
  expect(saved.buses[1]).toMatchObject({ class: 'SignalVoltageOut', ports_in: { ir: 2, ii: 3 }, ports_out: { vr: 0 } });
  expect(saved.buses[0]).not.toHaveProperty('ports');
  const copy = new CaseDocument(saved);
  expect(copy.export()).toEqual(saved);
  expect(elementIssues(copy, copy.get(input)!)).toEqual([]);
  expect(elementIssues(copy, copy.get(output)!)).toEqual([]);
  const signal = copy.rows('signals')[0]!.ref;
  expect(copy.dependents(signal)).toEqual(expect.arrayContaining([input, output]));
  expect(() => copy.edit(tx => tx.connect({ element: source, port: 'si' }, signal))).toThrow('only one output');
  copy.edit(tx => tx.update(signal, { signal_id: 42 }));
  expect(copy.export().buses[0]!.ports_in).toMatchObject({ vr: 42 });
  expect(() => copy.edit(tx => tx.remove([signal]))).toThrow('connected');
  copy.edit(tx => { tx.disconnect({ element: input, port: 'vr' }); tx.disconnect({ element: output, port: 'vr' }); tx.remove([signal]); });
  expect(copy.export().buses[0]!.ports_in).toEqual({ vi: 1 });
  document.apply(changes, 'backward'); expect(document.size).toBe(0);
  document.apply(changes); expect(document.export()).toEqual(saved);
});

it.runIf(develop)('keeps optional source functions absent and validates choices through the shared form', () => {
  const document = new CaseDocument(createCase()); let ref!: ElementRef;
  editCase(document, tx => { ref = tx.add('FunctionSignalSource'); });
  expect(elementIssues(document, document.get(ref)!)).toEqual([]);
  const request = { ref }, draft = createElementDraft(document, request);
  expect(draft.params![0]!.choices).toEqual(['sin', 'cos']);
  draft.params![0]!.text = 'sin';
  editCase(document, tx => tx.update(ref, submitElementDraft(document, request, draft).changes));
  expect(document.export().devices[0]!.params).toEqual({ Fr: 'sin' });
  const edited = createElementDraft(document, request); edited.params![0]!.text = '';
  editCase(document, tx => tx.update(ref, submitElementDraft(document, request, edited).changes));
  expect(document.export().devices[0]!.params).toEqual({});
  draft.params![0]!.text = 'sin(t)';
  expect(() => submitElementDraft(document, request, draft)).toThrow('highlighted fields');
});

it.runIf(develop)('preserves unknown native bus fields and rejects malformed known signal connections', () => {
  const value = { ...createCase(), buses: [{ number: 1, name: '', class: 'SignalVoltageIn', params: {},
    ports_in: { vr: 7, extra: 9 }, ports_out: { extra: 11 }, extension: { custom: true } }] };
  const saved = new CaseDocument(parseCase(JSON.stringify(value))).export().buses[0]!;
  expect(saved).toMatchObject(value.buses[0]!);
  expect(saved).not.toHaveProperty('ports');
  for (const vr of [null, '7', 1.5]) expect(() => new CaseDocument(parseCase(JSON.stringify({ ...value,
    buses: [{ ...value.buses[0], ports_in: { vr } }] }))))
    .toThrow('Invalid connection: SignalVoltageIn.vr');
});

it('evaluates conditional port requirements from the parameter draft', () => {
  const document = new CaseDocument(createCase()); let ref!: ElementRef;
  editCase(document, tx => { ref = tx.add('Esdc1a'); });
  const draft = createElementDraft(document, { ref });
  const port = draft.ports.find(port => port.key === 'speed')!;
  expect(portRequired(draft, port)).toBe(false);
  draft.params!.find(field => field.key === 'Spdmlt')!.text = 'true';
  expect(portRequired(draft, port)).toBe(true);
  editCase(document, tx => tx.update(ref, submitElementDraft(document, { ref }, draft).changes));
  expect(elementIssues(document, document.get(ref)!).map(issue => issue.field)).toContain('ports.speed');
});
