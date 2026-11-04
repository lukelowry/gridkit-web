import { expect, it } from 'vitest';
import { CaseDocument, caseReadiness, createCase, elementCatalog, elementIssues, models, parseCase, serializeCase, type ElementRef } from '@gridkit/library';
import { createElementDraft, elementDraftIssues, submitElementDraft } from '../elements/draft.js';
import { editCase } from '../domain/views.js';

it('validates native defaults without inserting omitted values or using creation presets', () => {
  const schema = elementCatalog.get('Branch')!.params;
  for (const params of [{}, { R: 0 }, { X: 0 }]) expect(schema.safeParse(params).success).toBe(false);
  for (const params of [{ R: 0.1 }, { X: 0.1 }]) expect(schema.parse(params)).toEqual(params);
});

it('updates load completion from its draft and rejects zero impedance without changing the case', () => {
  const document = new CaseDocument(createCase());
  let bus!: ElementRef, load!: ElementRef;
  editCase(document, tx => { bus = tx.add('Bus'); load = tx.add('LoadZ'); });
  const request = { ref: load }, draft = createElementDraft(document, request), before = document.export();
  expect(elementDraftIssues(document, request, draft).map(issue => issue.field)).toEqual(['params.R', 'params.X', 'ports.bus']);
  draft.params!.find(field => field.key === 'R')!.text = '1';
  draft.params!.find(field => field.key === 'X')!.text = '0';
  draft.ports[0]!.text = bus.id;
  expect(elementDraftIssues(document, request, draft)).toEqual([]);
  expect(document.export()).toEqual(before);
  draft.params!.find(field => field.key === 'R')!.text = '0';
  expect(elementDraftIssues(document, request, draft).map(issue => issue.field)).toEqual(['params.R', 'params.X']);
  expect(() => submitElementDraft(document, request, draft)).toThrow();
  expect(() => editCase(document, tx => tx.update(load, { params: { R: 0, X: 0 } }))).toThrow('both be zero');
  expect(document.export()).toEqual(before);
});

it('keeps incomplete branches discoverable for repair', () => {
  const document = new CaseDocument(createCase());
  let branch!: ElementRef;
  editCase(document, tx => {
    const a = tx.add('Bus'), b = tx.add('Bus'); branch = tx.add('Branch');
    tx.connect({ element: branch, port: 'bus1' }, a); tx.connect({ element: branch, port: 'bus2' }, b);
  });
  editCase(document, tx => tx.disconnect({ element: branch, port: 'bus2' }));
  expect(caseReadiness(document)).toEqual([{ ref: branch, field: 'ports.bus2', message: 'Connect To bus.' }]);
});

it('reports invalid imported impedance while allowing unrelated edits and preserving omitted fields', () => {
  const document = new CaseDocument({ ...createCase(), devices: [
    { class: 'Branch', id: 'branch', ports: {}, params: { R: 0, custom: 'keep' } },
  ] });
  const ref = document.rows('devices')[0]!.ref;
  const issues = () => elementIssues(document, document.get(ref)!).filter(issue => issue.field.startsWith('params.'));
  expect(issues().map(issue => issue.field)).toEqual(['params.R', 'params.X']);
  editCase(document, tx => tx.update(ref, { id: 'renamed' }));
  expect(document.export().devices[0]!.params).toEqual({ R: 0, custom: 'keep' });
  expect(issues()).toHaveLength(2);
  editCase(document, tx => tx.update(ref, { params: { R: 0.1, custom: 'keep' } }));
  expect(issues()).toEqual([]);
  expect(parseCase(serializeCase(document.export())).devices[0]!.params).toEqual({ R: 0.1, custom: 'keep' });
});

it('creates every declared model with its defaults and preserves unfinished values through editing and export', () => {
  const document = new CaseDocument(createCase());
  for (const model of models) {
    let ref!: ElementRef;
    editCase(document, tx => { ref = tx.add(model.id); });
    const row = document.get(ref)!;
    for (const parameter of model.params) {
      const value = model.preset?.params?.[parameter.id] ?? parameter.default;
      if (value === undefined) expect(row.value.params).not.toHaveProperty(parameter.id);
      else expect(row.value.params).toHaveProperty(parameter.id, value);
    }
    const request = { ref }, draft = createElementDraft(document, request);
    expect(draft.ports.map(port => port.key)).toEqual(model.ports.map(port => port.name));
    expect(draft.params?.map(field => field.key).sort()).toEqual(model.params.map(field => field.id).sort());
    const submission = submitElementDraft(document, request, draft);
    editCase(document, tx => tx.update(ref, submission.changes));
  }
  const copy = new CaseDocument(parseCase(serializeCase(document.export())));
  expect(copy.export()).toEqual(document.export());
  const sexs = copy.rows('devices').find(row => row.value.class === 'SexsPti')!;
  expect(sexs.value.params).toEqual({});
  expect(elementIssues(copy, sexs).map(issue => issue.field)).toContain('params.Ta');
});

it('creates and reuses one signal across ports atomically, including signal zero and history', () => {
  const document = new CaseDocument(createCase());
  let bus!: ElementRef, machine!: ElementRef, exciter!: ElementRef, stabilizer!: ElementRef;
  const changes = editCase(document, tx => {
    bus = tx.add('Bus'); machine = tx.add('Genrou'); exciter = tx.add('Ieeet1'); stabilizer = tx.add('Ieeest');
    tx.connect({ element: machine, port: 'bus' }, bus);
    tx.connect({ element: exciter, port: 'bus' }, bus);
    tx.connect({ element: machine, port: 'speed' }, { element: exciter, port: 'speed' });
    tx.connect({ element: machine, port: 'speed' }, { element: stabilizer, port: 'input' });
    tx.connect({ element: exciter, port: 'efd' }, { element: machine, port: 'efd' });
  })!;
  const saved = document.export();
  expect(saved.signals?.map(signal => signal.signal_id)).toEqual([0, 1]);
  expect(saved.devices[0]!.ports.speed).toBe(0);
  expect(saved.devices[1]!.ports.speed).toBe(0);
  expect(saved.devices[2]!.ports.input).toBe(0);
  const reopened = new CaseDocument(saved);
  expect(elementIssues(reopened, reopened.get(exciter)!).some(issue => issue.field.startsWith('ports.'))).toBe(false);
  document.apply(changes, 'backward');
  expect(document.size).toBe(0);
  document.apply(changes);
  expect(document.export()).toEqual(saved);
});

it('rejects incompatible ports, different signal merges, and multiple drivers without partial writes', () => {
  const document = new CaseDocument(createCase());
  let a!: ElementRef, b!: ElementRef, c!: ElementRef, d!: ElementRef;
  editCase(document, tx => { a = tx.add('Genrou'); b = tx.add('Ieeet1'); c = tx.add('Genrou'); d = tx.add('Ieeet1');
    tx.connect({ element: a, port: 'speed' }, { element: b, port: 'speed' });
    tx.connect({ element: c, port: 'speed' }, { element: d, port: 'speed' });
  });
  const before = document.export();
  expect(() => editCase(document, tx => tx.connect({ element: a, port: 'speed' }, { element: d, port: 'speed' }))).toThrow('different signals');
  expect(() => editCase(document, tx => tx.connect({ element: a, port: 'speed' }, { element: c, port: 'speed' }))).toThrow('output to an input');
  expect(() => editCase(document, tx => tx.connect({ element: a, port: 'bus' }, document.rows('signals')[0]!.ref))).toThrow('bus');
  expect(() => editCase(document, tx => tx.connect({ element: c, port: 'speed' }, document.rows('signals')[0]!.ref))).toThrow('only one output');
  expect(document.canConnect({ element: c, port: 'speed' }, document.rows('signals')[0]!.ref)).toBe(false);
  expect(document.export()).toEqual(before);
});

it('adds Network representations for new branches without adding controller mappings', () => {
  const document = new CaseDocument(createCase());
  editCase(document, tx => {
    tx.map({ mark: 'buses' }, 'color', '#123456');
    tx.removeMark({ mark: 'branches' });
  });
  const before = document.views;
  editCase(document, tx => { tx.add('Ieeet1'); });
  expect(document.views).toEqual(before);
  editCase(document, tx => { tx.add('Branch'); });
  expect(JSON.stringify(document.views)).toContain('branches');
  expect(new CaseDocument(document.export()).views).toEqual(document.views);
});
