import { expect, it, vi } from 'vitest';
import { CaseSession } from './session.svelte.js';
import { detailsOf, serializeCase } from '@gridkit/library';
import fixture from '../../../library/test/small.case.json';

const file = () => new File([JSON.stringify(fixture)], 'example.case.json');

it('preserves native export formatting after a file opens', async () => {
  const session = new CaseSession({ stopRun: async () => {}, confirmReplace: () => true });
  await session.open(new File([JSON.stringify({ ...fixture, devices: [
    { class: 'LoadZ', id: 'load', ports: { bus: 1 }, params: { R: 1, X: 0 } },
  ] })], 'example.case.json'));
  expect(serializeCase(session.editor.snapshot().value)).toContain('"R": 1.0');
});

it('keeps the previous case, study, and history when a replacement is invalid or cancellation fails', async () => {
  const stopRun = vi.fn(async () => {}), confirmReplace = vi.fn(() => true);
  const session = new CaseSession({ stopRun, confirmReplace });
  await session.open(file());
  session.editor.edit('Rename', tx => tx.details({ ...detailsOf(session.editor.info), case_name: 'Keep me' }));
  session.updateStudy({ ...session.study, tmax: 15 });
  const editor = session.editor, study = session.study;
  await expect(session.open(new File(['{'], 'invalid.json'))).rejects.toThrow();
  expect(confirmReplace).toHaveBeenCalledTimes(1);
  stopRun.mockRejectedValueOnce(new Error('Cancellation failed'));
  await expect(session.open(file())).rejects.toThrow('Cancellation failed');
  expect(session.editor).toBe(editor);
  expect(session.study).toBe(study);
  expect(session.editor.canUndo).toBe(true);
  expect(session.busy).toBe(false);
});

it('tracks case and study exports independently', async () => {
  const session = new CaseSession({ stopRun: async () => {}, confirmReplace: () => true });
  await session.open(file());
  session.updateStudy({ ...session.study, tmax: 15 });
  session.editor.edit('Rename', tx => tx.details({ ...detailsOf(session.editor.info), case_name: 'Edited' }));
  session.editor.markExported(session.editor.snapshot());
  expect(session.hasUnsavedChanges).toBe(true);
  expect(session.editor.info.header.case_name).toBe('Edited');
  expect(session.study.tmax).toBe(15);
  session.markStudyExported(session.study);
  expect(session.hasUnsavedChanges).toBe(false);
  session.editor.undo();
  expect(session.hasUnsavedChanges).toBe(true);
});

it('keeps the active case on declined replacement and clears all state on close', async () => {
  const confirmReplace = vi.fn(() => true), session = new CaseSession({ stopRun: async () => {}, confirmReplace });
  await session.open(file());
  session.editor.edit('Rename', tx => tx.details({ ...detailsOf(session.editor.info), case_name: 'Keep me' }));
  session.updateStudy({ ...session.study, tmax: 15 });
  const editor = session.editor;
  confirmReplace.mockReturnValueOnce(false);
  expect(await session.open(file())).toBe(false);
  expect(session.editor).toBe(editor);
  expect(session.study.tmax).toBe(15);
  expect(await session.close()).toBe(true);
  expect(session.opened).toBe(false);
  expect(session.editor.document.size).toBe(0);
  expect(session.editor.canUndo).toBe(false);
  expect(session.hasUnsavedChanges).toBe(false);
});
