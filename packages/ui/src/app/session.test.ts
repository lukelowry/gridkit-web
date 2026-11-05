import { expect, it, vi } from 'vitest';
import { CaseSession } from './session.svelte.js';
import { serializeCase } from '@gridkit/library';
import fixture from '../../../library/test/small.case.json';

const file = () => new File([JSON.stringify(fixture)], 'example.case.json');

it('preserves native export formatting after a file opens', async () => {
  const session = new CaseSession({ stopRun: async () => {}, confirmReplace: () => true });
  await session.open(new File([JSON.stringify({ ...fixture, devices: [
    { class: 'LoadZ', id: 'load', ports: { bus: 1 }, params: { R: 1, X: 0 } },
  ] })], 'example.case.json'));
  expect(serializeCase(session.current.snapshot().value)).toContain('"R": 1.0');
});

it('keeps the previous case and study when a replacement is invalid or cancellation fails', async () => {
  const stopRun = vi.fn(async () => {}), confirmReplace = vi.fn(() => true);
  const session = new CaseSession({ stopRun, confirmReplace });
  await session.open(file());
  session.updateStudy({ ...session.study, tmax: 15 });
  const current = session.current, study = session.study;
  await expect(session.open(new File(['{'], 'invalid.json'))).rejects.toThrow();
  expect(confirmReplace).toHaveBeenCalledTimes(1);
  stopRun.mockRejectedValueOnce(new Error('Cancellation failed'));
  await expect(session.open(file())).rejects.toThrow('Cancellation failed');
  expect(session.current).toBe(current);
  expect(session.study).toBe(study);
  expect(session.busy).toBe(false);
});

it('keeps current solver values separate from the opened case', async () => {
  const session = new CaseSession({ stopRun: async () => {}, confirmReplace: () => true });
  await session.open(file());
  session.updateStudy({ ...session.study, tmax: 15 });
  expect(session.current.info.header.case_name).toBe(fixture.header.case_name);
  expect(session.study.tmax).toBe(15);
  session.updateStudy({ ...session.study, tmax: 20 });
});

it('keeps the active case on declined replacement and clears all state on close', async () => {
  const confirmReplace = vi.fn(() => true), session = new CaseSession({ stopRun: async () => {}, confirmReplace });
  await session.open(file());
  session.updateStudy({ ...session.study, tmax: 15 });
  const current = session.current;
  confirmReplace.mockReturnValueOnce(false);
  expect(await session.open(file())).toBe(false);
  expect(session.current).toBe(current);
  expect(session.study.tmax).toBe(15);
  expect(await session.close()).toBe(true);
  expect(session.opened).toBe(false);
  expect(session.current.document.size).toBe(0);
});

it('keeps view mappings separate from case data, downloads and run identity', async () => {
  const original = { network: { marks: [{ id: 'buses', target: { collection: 'buses' }, kind: 'vertices', options: { radius: 4 } }] } };
  const session = new CaseSession({ stopRun: async () => {}, confirmReplace: () => true });
  await session.open(new File([JSON.stringify({ ...fixture, $ui: { views: original } })], 'mapped.case.json'));
  const before = session.current.snapshot().value, version = session.current.caseVersion;
  expect(session.mappings).toEqual(original);
  const changed = structuredClone(original);
  changed.network.marks[0]!.options.radius = 9;
  session.updateMappings(changed);
  changed.network.marks[0]!.options.radius = 20;
  expect(session.mappings).toMatchObject({ network: { marks: [{ options: { radius: 9 } }] } });
  expect(session.current.document.views).toEqual(original);
  expect(session.current.snapshot().value).toEqual(before);
  expect(session.current.caseVersion).toBe(version);
  await session.open(file());
  expect(session.mappings).toEqual({});
  session.updateMappings(original);
  await session.close();
  expect(session.mappings).toEqual({});
});

it('returning home stops the run and clears settings without a replacement prompt', async () => {
  const confirmReplace = vi.fn(() => true), stopRun = vi.fn(async () => {});
  const session = new CaseSession({ confirmReplace, stopRun });
  await session.open(file());
  confirmReplace.mockClear(); stopRun.mockClear();
  session.study.tmax = 20;
  expect(await session.close()).toBe(true);
  expect(confirmReplace).not.toHaveBeenCalled();
  expect(stopRun).toHaveBeenCalledOnce();
  expect(session.opened).toBe(false);
  expect(session.study.tmax).toBe(10);
});
