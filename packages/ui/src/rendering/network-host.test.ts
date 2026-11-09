import { beforeEach, expect, it, vi } from 'vitest';
import type { CaseDocument } from '@gridkit/library';
import type { NetworkScene } from './scene.js';
import { undocked, NetworkHost } from './network-host.svelte.js';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), done: vi.fn(), fit: vi.fn(), open: vi.fn(), destroy: vi.fn(), created: vi.fn(),
}));
vi.mock('../ui/latkit.js', () => ({ latkit: mocks.load }));
vi.mock('./data.js', () => ({ dataset: 'case' }));
vi.mock('./scene.js', () => ({ spaceOf: () => 'plane', tablesOf: () => new Set(['Bus']) }));
vi.mock('./view.js', () => ({ CaseView: class {
  constructor() { mocks.created(); }
  issues = [];
  input = undefined;
  view = { done: mocks.done, fit: mocks.fit, on: vi.fn(), insets: [0, 0, 0, 0], waiting: ['compiling'] };
  open(...args: unknown[]) { return mocks.open(...args); }
  show() { return false; }
  draw() {}
  destroy() { mocks.destroy(); }
} }));

const canvas = {} as HTMLCanvasElement;
const timeout = Object.assign(new Error('drawing timed out'), { code: 'timeout' });
const makeHost = () => new NetworkHost({
  document: () => ({} as CaseDocument), scene: () => ({} as NetworkScene),
  rows: () => new Map(), extra: () => [], dock: () => undocked,
  pitch: () => 0, listen: () => {},
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockReset().mockResolvedValue({});
  mocks.open.mockReset().mockResolvedValue(undefined);
  mocks.fit.mockReset().mockResolvedValue({});
  mocks.done.mockReset().mockResolvedValue(undefined);
});

it('reports a first-frame timeout instead of retrying indefinitely; retry rebuilds the view', async () => {
  mocks.done.mockRejectedValueOnce(timeout);
  const host = makeHost();
  host.activate(true);
  await host.show(canvas);
  await vi.waitFor(() => expect(host.fault).toContain('did not finish drawing: drawing timed out while waiting on compiling.'));
  expect(mocks.done).toHaveBeenCalledTimes(1);
  expect(host.ready).toBe(false);
  host.update();
  expect(host.fault).toContain('did not finish drawing');
  host.retry(canvas);
  await vi.waitFor(() => expect(host.ready).toBe(true));
  expect(mocks.created).toHaveBeenCalledTimes(2);
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
  expect(host.fault).toBe('');
  host.destroy();
});

it('says why latkit could not load', async () => {
  mocks.load.mockRejectedValueOnce(new Error('could not load latkit', { cause: new TypeError('Load failed') }));
  const host = makeHost();
  host.activate(true);
  await host.show(canvas);
  expect(host.fault).toBe('could not load latkit: Load failed');
  host.destroy();
});

it('says what to change when the browser has no WebGL2', async () => {
  mocks.load.mockRejectedValueOnce(Object.assign(new Error('WebGL2 is unavailable'), { code: 'unsupported' }));
  const host = makeHost();
  host.activate(true);
  await host.show(canvas);
  expect(host.fault).toBe('This browser has no WebGL2. Turn on hardware acceleration in its settings, or use Table.');
  host.destroy();
});

it('surfaces a non-timeout first-frame failure', async () => {
  mocks.done.mockRejectedValueOnce(new Error('GPU pipeline failed'));
  const host = makeHost();
  host.activate(true);
  await host.show(canvas);
  await vi.waitFor(() => expect(host.fault).toBe('GPU pipeline failed'));
  expect(host.ready).toBe(false);
  host.destroy();
});

it('ignores an old view that finishes opening after a retry', async () => {
  let resolve!: () => void;
  mocks.open.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
  const host = makeHost();
  host.activate(true);
  const opening = host.show(canvas);
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
  host.retry(canvas);
  await vi.waitFor(() => expect(host.ready).toBe(true));
  const replacement = host.opened;
  resolve();
  await opening;
  expect(host.opened).toBe(replacement);
  expect(host.ready).toBe(true);
  expect(host.fault).toBe('');
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
  host.destroy();
});

it('reports a failed initial camera fit instead of marking a blank view ready', async () => {
  mocks.fit.mockRejectedValueOnce(new Error('camera fit failed'));
  const host = makeHost();
  vi.spyOn(host, 'framed').mockReturnValue([['case', 'Bus']]);
  host.activate(true);
  await host.show(canvas);
  await vi.waitFor(() => expect(host.fault).toBe('camera fit failed'));
  expect(host.ready).toBe(false);
  host.destroy();
});

it('resumes a hidden canvas on return without reporting its expected timeout as failure', async () => {
  let reject!: (error: unknown) => void;
  mocks.done.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const host = makeHost();
  host.activate(true);
  await host.show(canvas);
  host.activate(false);
  reject(timeout);
  await Promise.resolve();
  expect(host.fault).toBe('');
  host.activate(true);
  await host.show(canvas);
  await vi.waitFor(() => expect(host.ready).toBe(true));
  host.destroy();
});

it('ignores a late frame failure after the case is closed', async () => {
  let reject!: (error: unknown) => void;
  mocks.done.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const host = makeHost();
  host.activate(true);
  await host.show(canvas);
  host.destroy();
  reject(timeout);
  await Promise.resolve();
  expect(host.fault).toBe('');
});
