import { expect, it, vi } from 'vitest';
import fixture from '../../test/stream.json';
import { conformance } from '../../test/conformance.js';
import { client } from '../client.js';
import { openReader, type EntriesQuery } from '../index.js';
import type { RunStatus } from '../protocol.js';
import { answer } from '../reply.js';
import { serve } from '../serve.js';
import { wasmBackend } from './backend.js';
import { gridkit, type GridKitCommand, type GridKitEvent, type GridKitStudy, type GridKitWorker } from './gridkit.js';
import { Host, type RunFiles } from './host.js';
import { checkEntries, checkRows, readEntries, readRows } from './reads.js';
import { Store, type Blocks } from './store.js';

/** Files held in memory, read and written by position as OPFS's sync access handles are. */
const memory = (): Blocks => {
  let data = new Uint8Array(0), size = 0;
  return {
    read(into, at) { const count = Math.max(0, Math.min(into.length, size - at)); into.set(data.subarray(at, at + count)); return count; },
    write(from, at) {
      if (at + from.length > data.length) { const grown = new Uint8Array(Math.max(at + from.length, 2 * data.length)); grown.set(data); data = grown; }
      data.set(from, at); size = Math.max(size, at + from.length);
      return from.length;
    },
    close() {},
  };
};
const names = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`);
const storeOf = (columns: readonly string[]) => new Store(columns, async () => memory());
/** Rows of [i/rate, value(i, c)…] from `first` to `last`. */
const rowsOf = (first: number, last: number, columns: number, rate: number, value: (i: number, c: number) => number) =>
  Float64Array.from({ length: (last - first) * (columns + 1) }, (_, k) => {
    const i = first + Math.floor(k / (columns + 1)), c = k % (columns + 1);
    return c ? value(i, c - 1) : i / rate;
  });

// The store, as the solver service's store_test.go checks it.

it('folds every level\'s entries from their rows, the last while it fills, however the rows arrive; a gap stays a gap', async () => {
  const width = 200, store = storeOf(names(width)), columns = [width - 1, 3, 0];
  const value = (i: number, column: number) => i === 77 && column === 3 ? NaN : Math.sin(i * (column + 1) / 50);
  /** The least and greatest of rows `first` to `last` of `column`, or NaN where one has a gap. */
  const fold = (first: number, last: number, column: number) => {
    const values = Array.from({ length: last - first + 1 }, (_, k) => value(first + k, column));
    return values.some(Number.isNaN) ? [NaN, NaN] : [Math.min(...values), Math.max(...values)];
  };
  let previous = 0;
  for (const count of [1, 7, 8, 9, 63, 64, 65, 600, 1001]) {
    await store.append(rowsOf(previous, count, width, 100, value));
    previous = count;
    for (let level = 0; level < store.levels; level++) {
      const span = 8 ** level, n = Math.ceil(count / span);
      const entries = Array.from({ length: n }, (_, index) => [index * span, Math.min((index + 1) * span, count) - 1] as const);
      const starts = entries.map(([first]) => first / 100), ends = entries.map(([, last]) => last / 100);
      const folded = entries.flatMap(([first, last]) => columns.map(column => fold(first, last, column)));
      const lows = folded.map(([low]) => low), highs = folded.map(([, high]) => high);
      expect([...store.planes(level, 0, n, columns)], `${count} rows, level ${level}`).toEqual(level ? [...starts, ...ends, ...lows, ...highs] : [...starts, ...lows]);
    }
  }
});

it('reads around a time, keeping equal times and gaps', async () => {
  const store = storeOf(['c']);
  await store.append(Float64Array.of(0, 1, 1, 2, 1, 3, 2, NaN));
  const [first, rows] = store.around(4, 1, 2);
  expect([first, rows]).toEqual([2, 2]);
  expect([...store.planes(0, first, rows, [0])]).toEqual([1, 2, 3, NaN]);
  // A pinned revision stops where it was.
  expect(store.around(2, 30, 8)).toEqual([1, 1]);
  expect(store.around(0, 30, 8)).toEqual([0, 0]);
  expect(store.around(4, -5, 1)[0]).toBe(0);
});

it('refuses unordered or invalid times', async () => {
  const store = storeOf(['a']);
  await store.append(Float64Array.of(1, 0, 2, 0));
  for (const rows of [[1.5, 0], [NaN, 0], [Infinity, 0]]) await expect(store.append(Float64Array.from(rows))).rejects.toMatchObject({ code: 'output' });
  expect(store.extent.rows).toBe(2);
});

it('names what is wrong with a selection', () => {
  const store = storeOf(['a', 'b']);
  expect(store.selection(['b', 'a'])).toEqual([1, 0]);
  expect(() => store.selection(['missing'])).toThrow('missing');
  expect(() => store.selection(['a', 'a'])).toThrow('once');
});

it('writes the recording back as the solver service does', async () => {
  const store = storeOf(['Bus_1_Vm', 'Bus_1_Va']);
  await store.append(Float64Array.of(0, 1.0370926850709157, -7.4044198300630096e-02, 1e-320, -0, NaN));
  const text = [...store.csv(store.extent)].map(chunk => new TextDecoder().decode(chunk)).join('');
  expect(text).toBe('t,Bus_1_Vm,Bus_1_Va\n0.0000000000000000e+00,1.0370926850709157e+00,-7.4044198300630096e-02\n'
    + '9.9998886718268301e-321,-0.0000000000000000e+00,NaN\n');
});

it('refuses reads once retired', async () => {
  const store = storeOf(['a']);
  await store.append(Float64Array.of(0, 1));
  store.retire();
  expect(() => store.planes(0, 0, 1, [0])).toThrow('expired');
});

// Reads, as the solver service's reads_test.go checks them.

it('answers the shared wire fixture exactly as the solver service does', async () => {
  const store = storeOf(fixture.columns);
  for (const row of fixture.rows) await store.append(Float64Array.from(row));
  /** A reply's JSON header and its planes, as the service wrote them. */
  const decoded = (text: string) => {
    const bytes = Buffer.from(text, 'base64'), size = bytes.readUInt32LE(0);
    return { header: JSON.parse(bytes.subarray(4, 4 + size).toString()), values: [...new Float64Array(bytes.buffer.slice(bytes.byteOffset + 4 + size, bytes.byteOffset + bytes.length))] };
  };
  const revision = { rows: store.extent.rows, state: 'completed', range: [store.extent.start, store.extent.end] };
  const rows = readRows(store, store.extent, checkRows(store, { columns: fixture.columns, maxBytes: 4096 }));
  expect({ header: { ...revision, first: rows.first, count: rows.count }, values: [...rows.values] }).toEqual(decoded(fixture.replies.rows));
  // The coarse level's whole bucket, and the one still filling.
  const query = { columns: fixture.columns, level: 1, first: 0, count: 2, maxBytes: 4096 };
  const entries = readEntries(store, store.extent, checkEntries(store, query), query);
  expect({ header: { ...revision, first: entries.first, count: entries.count }, values: [...entries.values] }).toEqual(decoded(fixture.replies.entries));
});

it('stops entries at what is recorded, and refuses a level it holds no whole entry of or a read past its budget', async () => {
  const store = storeOf(['a']);
  await store.append(rowsOf(0, 10, 1, 1, i => i));
  const read = (asked: Partial<EntriesQuery>) => {
    const query = { columns: ['a'], level: 0, first: 0, count: 8, maxBytes: 4096, ...asked };
    return readEntries(store, store.extent, checkEntries(store, query), query).count;
  };
  expect([read({ first: 8 }), read({ first: 10 }), read({ level: 1 })]).toEqual([2, 0, 2]);
  // Two coarse entries are 64 bytes: their starts, ends, minima and maxima.
  for (const query of [{ columns: [] }, { level: -1 }, { level: 2 }, { first: -1 }, { count: 0 }, { level: 1, count: 2, maxBytes: 63 }, { maxBytes: (16 << 20) + 1 }])
    expect(() => read(query), JSON.stringify(query)).toThrow('Invalid read.');
});

it('reads every Nth row as it says', async () => {
  const store = storeOf(names(3));
  await store.append(rowsOf(0, 100, 3, 1, (i, c) => i * 10 + c));
  expect([...store.sampled(5, 3, 10, [2, 0])]).toEqual([5, 15, 25, 52, 50, 152, 150, 252, 250]);
});

// The solver in the page: a run's life, read back through a reader's own port.

function host() {
  const statuses: { run: string; status: RunStatus; log?: string | undefined }[] = [], removed: string[] = [];
  let report: (event: GridKitEvent) => void = () => {}, stopped = 0;
  const local = new Host({
    files: async run => ({ open: async () => memory(), remove: async () => { removed.push(run); } }) satisfies RunFiles,
    gridkit: (_study: GridKitStudy, events) => { report = events; return { stop: () => { stopped++; } }; },
    status: (run, status, log) => statuses.push({ run, status, log }),
  });
  /** A reader of `run`, answered by the host as a solver's worker answers one. */
  const reader = (run: string) => {
    const { port1, port2 } = new MessageChannel();
    answer(port1, async question => question.op === 'rows' ? local.rows(run, question.query)
      : question.op === 'entries' ? local.entries(run, question.query) : { header: {}, parts: local.csv(run) });
    return openReader(port2);
  };
  const start: GridKitStudy = { settings: {}, model: new Blob() };
  return { local, statuses, removed, start, reader, emit: (event: GridKitEvent) => report(event), stopped: () => stopped };
}
const last = (statuses: { status: RunStatus }[]) => statuses.at(-1)!.status;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('runs a study and reads it back through the page\'s reader as the solver service would answer', async () => {
  const { local, statuses, start, reader, emit } = host(), signal = new AbortController().signal;
  await local.start('a', start);
  // Until GridKit records, the run is preparing: nothing is said of it.
  expect(statuses).toEqual([]);
  emit({ kind: 'columns', columns: ['v'] });
  expect(last(statuses)).toMatchObject({ state: 'running', rows: 0, range: null });
  const results = reader('a'), waiting = results.rows({ columns: ['v'], from: 0, wait: true, maxBytes: 4096 }, signal);
  emit({ kind: 'rows', rows: Float64Array.of(0, 1.1, 1, 0.7) });
  emit({ kind: 'log', text: 'Hygov: effective Hdam raised' });
  emit({ kind: 'exit', status: 0 });
  const rows = await waiting;
  expect([...rows.samples.times]).toEqual([0, 1]);
  expect([...rows.samples.values]).toEqual([1.1, 0.7]);
  await settle();
  expect(statuses.at(-1)).toMatchObject({ run: 'a', status: { state: 'completed', rows: 2, range: [0, 1] }, log: 'Hygov: effective Hdam raised\n' });
  const { state, block } = await results.entries({ columns: ['v'], level: 0, first: 0, count: 8, maxBytes: 4096 }, signal);
  expect({ state, kind: block.kind, values: block.kind === 'samples' && [...block.values] }).toEqual({ state: 'completed', kind: 'samples', values: [1.1, 0.7] });
  await expect(results.rows({ columns: ['missing'], maxBytes: 4096 }, signal)).rejects.toMatchObject({ code: 'invalid' });
  results.close();

  const chunks: string[] = [];
  for await (const chunk of local.csv('a')) chunks.push(new TextDecoder().decode(chunk));
  expect(chunks.join('')).toBe('t,v\n0.0000000000000000e+00,1.1000000000000001e+00\n1.0000000000000000e+00,6.9999999999999996e-01\n');
});

it('fails a run that exits badly or records nothing, as the solver service says it', async () => {
  for (const [events, error] of [
    [[{ kind: 'columns', columns: ['v'] }, { kind: 'exit', status: 1 }], { code: 'simulation', message: 'DynamicSimulation exited with code 1. Download the log for details.' }],
    [[{ kind: 'columns', columns: ['v'] }, { kind: 'exit', status: 0 }], { code: 'output', message: 'DynamicSimulation recorded no samples.' }],
    [[{ kind: 'columns', columns: ['v'] }, { kind: 'rows', rows: Float64Array.of(1, 0, 0, 0) }], { code: 'output', message: 'The recording\'s times are not ordered.' }],
    [[{ kind: 'error', message: 'Aborted(OOM)' }], { code: 'simulation', message: 'Aborted(OOM)' }],
  ] as [GridKitEvent[], object][]) {
    const { local, statuses, start, emit } = host();
    await local.start('a', start);
    for (const event of events) emit(event);
    await settle();
    expect(last(statuses)).toMatchObject({ state: 'failed', error });
  }
});

it('cancels at once, refuses a second study while one runs, and retires the last for the next', async () => {
  const { local, statuses, removed, start, reader, emit, stopped } = host(), signal = new AbortController().signal;
  await local.start('a', start);
  emit({ kind: 'columns', columns: ['v'] });
  emit({ kind: 'rows', rows: Float64Array.of(0, 1) });
  await expect(local.start('b', start)).rejects.toMatchObject({ code: 'busy' });
  await local.cancel('a');
  expect(stopped()).toBe(1);
  expect(last(statuses)).toMatchObject({ state: 'cancelled', rows: 1 });
  const results = reader('a');
  await local.start('b', start);
  expect(removed).toEqual(['a']);
  await expect(results.rows({ columns: ['v'], maxBytes: 4096 }, signal)).rejects.toMatchObject({ code: 'expired' });
  await expect(reader('b').rows({ columns: ['v'], maxBytes: 4096 }, signal)).rejects.toMatchObject({ code: 'unavailable' });
});

// GridKit's workers: each study is given one that GridKit is ready in, readied ahead of it.

/** A GridKit worker as the solver sees one: its script loads or does not, then GridKit is readied in it or is not. */
class Worked {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  given: GridKitCommand['kind'][] = [];
  terminated = false;
  constructor(readonly behaviour: 'ready' | 'unloadable' | 'unpreparable') {
    // A script that cannot load fails before anything is said to it, with no message.
    if (behaviour === 'unloadable') queueMicrotask(() => this.onerror?.call(this as never, { message: '', preventDefault() {} } as ErrorEvent));
  }
  postMessage(command: GridKitCommand) {
    this.given.push(command.kind);
    const say = (data: GridKitEvent) => queueMicrotask(() => this.onmessage?.call(this as never, { data } as MessageEvent));
    if (command.kind === 'study') { say({ kind: 'columns', columns: ['v'] }); say({ kind: 'exit', status: 0 }); }
    else say(this.behaviour === 'ready' ? { kind: 'ready' } : { kind: 'error', message: 'GridKit could not be instantiated.' });
  }
  terminate() { this.terminated = true; }
}
/** GridKit for studies, its workers made as `behaviours` says in turn, and what each study reports. */
function studies(behaviours: Worked['behaviour'][], compile = async () => ({}) as WebAssembly.Module) {
  const spawned: Worked[] = [];
  const start = gridkit('DynamicSimulation.mjs', () => {
    const worker = new Worked(behaviours[spawned.length] ?? 'ready');
    spawned.push(worker);
    return worker as unknown as GridKitWorker;
  }, compile);
  const run = () => {
    const events: GridKitEvent[] = [];
    return { events, ...start({ settings: {}, model: new Blob() }, event => events.push(event)) };
  };
  return { spawned, run };
}
const kinds = (events: readonly GridKitEvent[]) => events.map(event => event.kind);

it("readies the next study's GridKit ahead of it, and ends each study's worker with it", async () => {
  const { spawned, run } = studies([]);
  expect(spawned).toHaveLength(1);
  const { events } = run();
  await vi.waitFor(() => expect(kinds(events)).toEqual(['columns', 'exit']));
  expect(spawned.map(worker => worker.given)).toEqual([['prepare', 'study'], ['prepare']]);
  expect(spawned.map(worker => worker.terminated)).toEqual([true, false]);
});

it('replaces a GridKit that could not load, and fails the study with why only when its replacement cannot either', async () => {
  const replaced = studies(['unloadable', 'ready', 'ready']), { events } = replaced.run();
  await vi.waitFor(() => expect(kinds(events)).toEqual(['columns', 'exit']));
  expect(replaced.spawned.map(worker => [worker.given.includes('study'), worker.terminated])).toEqual([[false, true], [false, false], [true, true]]);
  const failed = studies(['unpreparable', 'ready', 'unpreparable']), run = failed.run();
  await vi.waitFor(() => expect(run.events).toEqual([{ kind: 'error', message: 'GridKit could not start: GridKit could not be instantiated.' }]));
  expect(failed.spawned.map(worker => worker.given.includes('study'))).toEqual([false, false, false]);
});

it('downloads GridKit again after a download fails, and starts no study that was stopped while it waited', async () => {
  let downloads = 0;
  const { spawned, run } = studies([], async () => { if (!downloads++) throw new TypeError('Failed to fetch'); return {} as WebAssembly.Module; });
  const { events } = run();
  await vi.waitFor(() => expect(kinds(events)).toEqual(['columns', 'exit']));
  expect(downloads).toBe(2);
  const stopped = run();
  stopped.stop();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(stopped.events).toEqual([]);
  expect(spawned.some(worker => worker.given.filter(kind => kind === 'study').length > 1)).toBe(false);
  expect(spawned.filter(worker => worker.given.includes('study')).every(worker => worker.terminated)).toBe(true);
});

// The solver in the page, held to the contract every solver meets: its host in this thread, GridKit a stand-in writing rows.

/** GridKit as the host drives it: columns, then ten rows every few milliseconds, until `tmax` or until it is stopped. */
function standIn(study: GridKitStudy, report: (event: GridKitEvent) => void) {
  const { tmax } = study.settings as { tmax: number };
  let next = 0;
  const timer = setInterval(() => {
    if (!next) report({ kind: 'columns', columns: ['a', 'b'] });
    const rows = new Float64Array(30);
    for (let i = 0; i < 10; i++, next++) rows.set([next / 100, Math.sin(next), Math.cos(next)], 3 * i);
    report({ kind: 'rows', rows });
    if (next / 100 >= tmax) { clearInterval(timer); report({ kind: 'exit', status: 0 }); }
  }, 2);
  return { stop: () => clearInterval(timer) };
}
const study = (tmax: number) => async () => ({ request: { study: { tmax }, model: new Blob(['{}']) }, columns: ['a', 'b'] });
conformance('GridKit in the page', {
  async connect() {
    const { port1, port2 } = new MessageChannel();
    serve(async (_options, report) => wasmBackend({ files: async () => ({ open: async () => memory(), remove: async () => {} }), gridkit: standIn, engine: {} }, report), port2);
    return (await client(port1, {}))!;
  },
  quick: study(1),
  long: study(Infinity),
}, 10_000);
