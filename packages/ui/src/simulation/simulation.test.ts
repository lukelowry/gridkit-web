import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { load } from 'latkit';
import ieee39 from '../../../../library/IEEE39.case.json';
import wecc240 from '../../../../library/WECC240.case.json';
import { CaseDocument, parseCase } from '@gridkit/library';
import { referenceField } from '../domain/measure.js';
import type { Progress, ResultReader, RowsQuery, RunState, RunUpdate, Solver } from '@gridkit/solver';
import { Connection } from '../services/connection.svelte.js';
import type { ResultsMessage, ResultsReply } from './results.js';
import { ResultHost, transferOf } from './results.worker.js';
import { Simulation } from './simulation.svelte.js';
import { defaultStudy } from '@gridkit/library/gridkit';
import * as gridkit from '@gridkit/library/gridkit';
import { latkit } from '../ui/latkit.js';
import { RunSession } from './run.svelte.js';

const workers: { reader?: ResultReader } = {};
vi.mock('../ui/latkit.js', () => ({ latkit: vi.fn(async () => ({})) }));
// Exercise the real facade and host together, including transferable detachment.
class WorkerStub {
  onmessage?: (event: { data: ResultsReply }) => void;
  host = new ResultHost(() => workers.reader!);
  closed = false;
  async postMessage(message: ResultsMessage) {
    if (message.kind === 'close') { this.terminate(); return; }
    try {
      const value = await this.host.handle(message);
      if (!this.closed) this.onmessage?.({ data: { id: message.id, value: structuredClone(value, { transfer: transferOf(value) }) } });
    } catch (cause) {
      const error = cause as Error;
      this.onmessage?.({ data: { id: message.id, error: { name: error.name, message: error.message } } });
    }
  }
  terminate() { this.closed = true; this.host.close(); }
}

beforeAll(async () => { await load({ wasm: await WebAssembly.compile(new Uint8Array(await readFile(new URL(import.meta.resolve('latkit/wasm'))))) }); });
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reports compilation failure while GPU initialization is still pending', async () => {
  vi.mocked(latkit).mockImplementationOnce(() => new Promise(() => {}));
  vi.spyOn(gridkit, 'compile').mockImplementationOnce(() => { throw new Error('Case cannot be compiled'); });
  const start = vi.fn(() => { throw new Error('Unexpected solver start'); });
  const run = new RunSession({ engine: {}, start, close() {} }, new CaseDocument(parseCase(JSON.stringify(ieee39))),
    0, defaultStudy(), { basis: 'value', band: null, speed: 1 });
  try {
    await vi.waitFor(() => expect(run.error).toBe('Case cannot be compiled'));
    expect(run.failed).toBe(true);
    expect(run.busy).toBe(false);
    expect(start).not.toHaveBeenCalled();
  } finally { run.close(); }
});

it('ignores a late GPU initialization failure after the run is closed', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(latkit).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const start = vi.fn(() => { throw new Error('Unexpected solver start'); });
  const run = new RunSession({ engine: {}, start, close() {} }, new CaseDocument(parseCase(JSON.stringify(ieee39))),
    0, defaultStudy(), { basis: 'value', band: null, speed: 1 });
  run.close();
  reject(new Error('GPU initialization failed'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(run.error).toBe('');
  expect(run.busy).toBe(false);
  expect(start).not.toHaveBeenCalled();
});

it('asks a run it can no longer hear to stop, so it does not hold the solver', async () => {
  vi.stubGlobal('Worker', WorkerStub);
  const cancel = vi.fn(async () => {});
  const client: Solver = { engine: {}, close() {}, start: () => ({ cancel, results: async () => new MessageChannel().port1, artifacts: Promise.resolve([]),
    async *updates() { yield { state: 'running', progress: null }; throw new Error('Failed to fetch'); } }) };
  const run = new RunSession(client, new CaseDocument(parseCase(JSON.stringify(ieee39))), 0, defaultStudy(), { basis: 'value', band: null, speed: 1 });
  try {
    await vi.waitFor(() => expect(run.failed).toBe(true));
    expect(run.error).toBe('Failed to fetch');
    expect(run.busy).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  } finally { run.close(); }
});

function inbox<T>(signal: AbortSignal) {
  const queue: T[] = [];
  let waiting: ((value: T | undefined) => void) | undefined;
  return {
    send(value: T) {
      if (signal.aborted) return;
      if (waiting) { const wake = waiting; waiting = undefined; wake(value); }
      else queue.push(value);
    },
    async *[Symbol.asyncIterator]() {
      const stop = () => waiting?.(undefined);
      signal.addEventListener('abort', stop, { once: true });
      try {
        while (!signal.aborted) {
          const value = queue.shift() ?? await new Promise<T | undefined>(resolve => { waiting = resolve; });
          if (value === undefined || signal.aborted) return;
          yield value;
        }
      } finally { signal.removeEventListener('abort', stop); }
    },
  };
}

async function setup(fixture: unknown) {
  vi.stubGlobal('Worker', WorkerStub);
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  let now = 0, value = 1, state: RunState = 'running';
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)));
  // What the run has recorded: a row per time, and those waiting for more.
  const times = [0, 1], waiting = new Set<() => void>();
  const grown = (signal: AbortSignal, done: () => boolean) => new Promise<void>((resolve, reject) => {
    if (done()) { resolve(); return; }
    const wake = () => { if (done()) { waiting.delete(wake); resolve(); } };
    waiting.add(wake);
    signal.addEventListener('abort', () => { waiting.delete(wake); reject(signal.reason); }, { once: true });
  });
  const ended = () => state !== 'running';
  const revision = () => ({ rows: times.length, state, range: [times[0]!, times.at(-1)!] as const });
  const rows = vi.fn(async (query: RowsQuery, signal: AbortSignal) => {
    if (query.at !== undefined) {
      return { ...revision(), samples: { kind: 'samples' as const, first: 0, columns: query.columns, times: Float64Array.of(0), values: new Float64Array(query.columns.length).fill(value) } };
    }
    const from = query.from ?? 0;
    if (query.wait) await grown(signal, () => times.length > from || ended());
    const held = times.slice(from);
    return { ...revision(), samples: { kind: 'samples' as const, first: from, columns: query.columns, times: Float64Array.from(held), values: new Float64Array(held.length * query.columns.length).fill(value) } };
  });
  // The plot's tiles are read only as a view draws them, and no view draws here.
  workers.reader = { rows, entries: async () => { throw new Error('Unexpected entries.'); }, close() {} };
  let progress: Progress = { rows: times.length, range: [0, 1] };
  let watch: ReturnType<typeof inbox<RunUpdate>>;
  const client: Solver = {
    engine: {},
    start: () => ({ cancel: async () => {},
      results: async () => new MessageChannel().port1, artifacts: Promise.resolve([]),
      async *updates(signal) { watch = inbox(signal!); yield { state: 'running', progress }; yield* watch; },
    }),
    close() {},
  };
  const solver = new Connection(async () => client);
  await solver.connect();
  const simulation = new Simulation(solver);
  const study = { ...defaultStudy(), tmax: 20 };
  const runs = [simulation.start(document, 0, study)];
  cleanup = async () => { simulation.close(); await Promise.all(runs); };
  await vi.waitFor(() => expect(simulation.run!.plot).toBeDefined());
  return {
    simulation, study, rows, rowsCalls: () => rows.mock.calls.length,
    advance(time: number, next: number, nextValue = value, nextState: RunUpdate['state'] & RunState = 'running') {
      now = time; value = nextValue; state = nextState;
      times.push(next);
      progress = { rows: times.length, range: [0, next] };
      watch.send(nextState === 'failed' ? { state: nextState, progress, error: { code: 'test', message: 'Stopped' } } : { state: nextState, progress } as RunUpdate);
      for (const wake of [...waiting]) wake();
    },
    restart() { simulation.close(); study.tmax = 5; runs.push(simulation.start(document, 1, study)); },
  };
}

for (const fixture of [ieee39, wecc240]) {
  for (const terminal of ['completed', 'cancelled', 'failed'] as const) it(`${fixture.header.case_name}: fixes the submitted timeline through ${terminal} and the next run`, async () => {
    const { simulation, study, advance, restart } = await setup(fixture);
    const camera = simulation.run!.plot!.camera;
    expect(camera.x).toEqual([0, 20]);
    expect(simulation.run!.range).toEqual([0, 1]);
    study.tmax = 99;

    advance(150, 3);
    await vi.waitFor(() => expect(simulation.run!.range[1]).toBe(3));
    expect(simulation.run!.plot!.camera).toBe(camera);
    expect(simulation.run!.timeline).toEqual([0, 20]);

    advance(175, 4, 2, terminal);
    await vi.waitFor(() => expect(simulation.run!.range[1]).toBe(4));
    // The run's end commands no camera either: latkit fits the values it drew.
    expect(simulation.run!.plot!.camera).toBe(camera);
    expect(simulation.run!.busy).toBe(false);
    expect(simulation.run!.plot!.camera.x).toEqual([0, 20]);
    expect(simulation.run!.range).toEqual([0, 4]);
    simulation.run!.fit();
    expect(simulation.run!.plot!.camera.x).toEqual([0, 20]);

    restart();
    await vi.waitFor(() => expect(simulation.run?.plot?.camera.x).toEqual([0, 5]));
    expect(simulation.run!.timeline).toEqual([0, 5]);
  });

  it(`${fixture.header.case_name}: holds the whole run, so showing any time asks the solver nothing`, async () => {
    const { simulation, advance, rowsCalls } = await setup(fixture);
    const run = simulation.run!;
    await vi.waitFor(() => expect(run.sampledFields.some(field => field.field === 'Vm')).toBe(true));
    advance(100, 2); advance(200, 3, 1, 'completed');
    await vi.waitFor(() => expect(run.data!.describe().span?.[1]).toBe(3));
    expect(run.playhead.time).toBe(3);
    await new Promise(resolve => setTimeout(resolve, 60));
    const asked = rowsCalls();
    // Back and forth over everything recorded: every time shows at once.
    for (const time of [0.5, 2.5, 0, 3, 1, 99, -5]) {
      run.seek(time);
      expect(run.playhead.time).toBe(Math.max(0, Math.min(3, time)));
    }
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(rowsCalls()).toBe(asked);
    expect(run.data!.get('Bus', simulationRow(run), 'Vm', { at: 2 })).toBe(1);
    expect(run.live).toBe(false);
  });

  it(`${fixture.header.case_name}: measures the network from any recorded time without reading the run again`, async () => {
    const { simulation, advance, rows } = await setup(fixture);
    const run = simulation.run!, id = simulationRow(run), from = referenceField('Vm');
    // Without a reference, deviations are measured from the first sample.
    await vi.waitFor(() => expect(run.data!.get('Bus', id, from)).toBe(1));
    advance(100, 2, 3);
    await vi.waitFor(() => expect(run.data!.describe().span?.[1]).toBe(2));
    const restarts = () => rows.mock.calls.filter(([query]) => query.at === undefined && !query.from).length, before = restarts();
    run.measure('change', 2);
    expect(run.data!.get('Bus', id, from)).toBe(3);
    run.measure('change', null);
    expect(run.data!.get('Bus', id, from)).toBe(1);
    expect(restarts()).toBe(before);
  });

  it(`${fixture.header.case_name}: preserves manual framing, leaves the values to latkit's fit, and keeps each measure's tiles`, async () => {
    const { simulation, study, advance } = await setup(fixture);
    const run = simulation.run!, camera = run.plot!.camera, tiles = run.plot!.source;
    // Streaming adds samples and never commands the camera: latkit fits the values in view.
    expect(camera.y).toBeNull();
    advance(50, 2, 2);
    await vi.waitFor(() => expect(run.range[1]).toBe(2));
    advance(150, 3, 2);
    await vi.waitFor(() => expect(run.range[1]).toBe(3));
    expect(run.plot!.camera).toBe(camera);
    expect(run.plot!.camera.x).toEqual([0, 20]);

    // A gesture's camera is kept without commanding the view: latkit fetches what the window shows, from the same tiles.
    const version = run.plot!.camera.version;
    run.viewport({ x: [0, 20], y: [0.9, 1.1] });
    const manual = run.plot!.camera;
    advance(500, 5, 3);
    await vi.waitFor(() => expect(run.range[1]).toBe(5));
    expect(run.plot!.camera).toBe(manual);
    expect(manual.version).toBe(version);
    run.viewport({ x: [1, 2], y: [0.8, 1.2] });
    expect(run.plot!.source).toBe(tiles);
    const zoomed = run.plot!.camera;
    run.seek(99);
    expect(run.playhead.time).toBe(5);
    run.follow();
    expect(run.live).toBe(true);
    expect(run.plot!.camera).toBe(zoomed);

    const angle = run.quantities.find(quantity => quantity.output === 'Va')!;
    run.select(angle.key);
    await vi.waitFor(() => expect(run.plot!.quantity).toBe(angle));
    const angles = run.plot!.source;
    expect(angles).not.toBe(tiles);
    // A new quantity unpins the values, keeping the times.
    expect(run.plot!.camera).toMatchObject({ x: [1, 2], y: null });
    run.fit();
    expect(run.plot!.camera.x).toEqual([0, 20]);

    // A measure replaces the plot's feed and refits its values, keeping its times; an angle has no percent.
    run.measure('percent', 1);
    await vi.waitFor(() => expect(run.plot).toMatchObject({ basis: 'percent', reference: 1 }));
    expect(run.plot!.camera).toMatchObject({ x: [0, 20], y: null });
    run.select(run.quantities.find(quantity => quantity.output === 'Vm')!.key);
    expect(run.basis).toBe('percent');
    expect(run.networkMeasure).toEqual({ output: 'Vm', basis: 'percent' });
    run.select(angle.key);
    expect(run.basis).toBe('change');
    expect(run.networkMeasure).toEqual({ output: 'Va', basis: 'change' });
    await vi.waitFor(() => expect(run.plot).toMatchObject({ quantity: angle, basis: 'change' }));
    // What the network's scene reads installs each output it names, once its samples arrive; every measure of it reads that.
    run.sample([{ collection: 'buses', field: 'Va~change' }]);
    await vi.waitFor(() => expect(run.sampledFields.some(field => field.field === 'Va')).toBe(true));
    expect(run.sampledFields.some(field => field.field === 'Vm')).toBe(false);
    expect(run.data!.get('Bus', simulationRow(run), 'Vm')).toBeNull();
    // A measure shown again draws the tiles it fetched.
    run.measure('value', null);
    expect(run.plot!.source).toBe(angles);

    // The submitted output interval sets what is held, even after settings are edited.
    study.dt_monitor = 1;
    expect(run.timeline).toEqual([0, 20]);
  });
}

it('runs a study where the browser has no device to draw with: its data loads before a device is asked for', async () => {
  vi.mocked(latkit).mockImplementationOnce(async () => { throw Object.assign(new Error('This browser has no WebGL2.'), { code: 'unsupported' }); });
  const { simulation } = await setup(ieee39), run = simulation.run!;
  expect(run.error).toBe('');
  expect(run.failed).toBe(false);
  await vi.waitFor(() => expect(run.data!.get('Bus', simulationRow(run), 'Vm', { at: 1 })).toBe(1));
});

it('plots every series of a large quantity, narrows to selected and pinned elements when asked, and keeps network playback independent', async () => {
  const value = { ...ieee39, buses: [...ieee39.buses, ...Array.from({ length: 513 - ieee39.buses.length }, (_, i) => ({ ...ieee39.buses[0]!, number: 10_000 + i }))] };
  const { simulation } = await setup(value), run = simulation.run!;
  const [first, second] = run.quantity!.channels;
  expect(run.plotMode).toBe('all');
  expect(run.plot!.quantity.channels).toHaveLength(513);
  run.setPlotMode('focused');
  expect(run.plot).toBeUndefined();
  run.focusPlot(first!.element);
  await vi.waitFor(() => expect(run.plot?.quantity.channels).toEqual([first]));
  run.pinPlot(first!.element);
  run.focusPlot(second!.element);
  await vi.waitFor(() => expect(run.plot?.quantity.channels).toEqual([first, second]));
  run.unpinPlot(first!.element);
  await vi.waitFor(() => expect(run.plot?.quantity.channels).toEqual([second]));
  run.focusPlot(null);
  expect(run.plot).toBeUndefined();
  run.setPlotMode('all');
  await vi.waitFor(() => expect(run.plot?.quantity.channels).toHaveLength(513));
  await vi.waitFor(() => expect(run.data!.get('Bus', first!.element.id, 'Vm', { at: 1 })).toBe(1));
  run.seek(0.5);
  expect(run.playhead.time).toBe(0.5);
});

function simulationRow(run: { channels: readonly { output: string; element: { id: string } }[] }) {
  return run.channels.find(channel => channel.output === 'Vm')!.element.id;
}
