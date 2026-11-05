import { expect, it, vi } from 'vitest';
import fixture from '../../test/stream.json';
import { conformance } from '../../test/conformance.js';
import { client } from '../client.js';
import { openReader, type SummaryQuery, type TileDescription, type TimeRange } from '../index.js';
import type { RunStatus } from '../protocol.js';
import { answer } from '../reply.js';
import { serve } from '../serve.js';
import { wasmBackend } from './backend.js';
import { gridkit, type GridKitCommand, type GridKitEvent, type GridKitStudy, type GridKitWorker } from './gridkit.js';
import { Host, type RunFiles } from './host.js';
import { checkRows, checkSummary, readRows, summarize, tiles } from './reads.js';
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
/** A summary planned and its tiles read, as a reader receives them. */
function read(store: Store, query: SummaryQuery) {
  const columns = checkSummary(store, query), plan = summarize(store, store.extent, query, columns.length);
  return { ...plan, pages: plan.tiles.map(tile => ({ tile, values: store.planes(tile.level, tile.first, tile.rows, columns) })) };
}

// The store, as the solver service's store_test.go checks it.

it('keeps extremes at every level', async () => {
  const store = storeOf(names(4)), count = 20000;
  for (let first = 0; first < count; first += 127) {
    await store.append(rowsOf(first, Math.min(first + 127, count), 4, 1000, (i, c) => c !== 1 ? 0 : i === 4031 ? 900 : i === 8173 ? -700 : Math.sin(i / 1000)));
  }
  expect(store.extent).toMatchObject({ rows: count, start: 0, end: 19.999 });
  for (let level = 1, span = 8; span <= count; level++, span *= 8) {
    const rows = Math.floor(count / span), values = store.planes(level, 0, rows, [1]);
    expect([Math.min(...values.subarray(2 * rows, 3 * rows)), Math.max(...values.subarray(3 * rows, 4 * rows))], `level ${level}`).toEqual([-700, 900]);
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

it('keeps a gap a gap in coarse entries', async () => {
  const store = storeOf(['a']);
  await store.append(rowsOf(0, 64, 1, 1, i => i === 9 ? NaN : i));
  // Starts, ends, minima, maxima of two buckets: the first whole, the second holding the gap.
  expect([...store.planes(1, 0, 2, [0])]).toEqual([0, 8, 7, 15, 0, NaN, 7, NaN]);
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
  const summary = read(store, { columns: fixture.columns, range: null, resolution: 100, maxBytes: 4096 });
  expect({ header: { ...revision, reset: summary.reset, cursor: summary.cursor, tiles: summary.tiles }, values: summary.pages.flatMap(page => [...page.values]) })
    .toEqual(decoded(fixture.replies.summary));
});

it('keeps exact times across ten thousand columns, whatever the packet size', async () => {
  const columns = names(10000), store = storeOf(columns), value = (i: number, c: number) => i + c / 100000;
  for (let first = 0; first < 1001; first += 26) await store.append(rowsOf(first, Math.min(first + 26, 1001), 10000, 100, value));
  for (const budget of [512 * 1024, 2 * 1024 * 1024]) {
    const { pages } = read(store, { columns, range: [0, 10], resolution: 1250, maxBytes: budget });
    expect(pages.length).toBeGreaterThan(1);
    let cursor = 0;
    for (const { tile, values } of pages) {
      expect(values.length * 8).toBeLessThanOrEqual(budget);
      expect(tile).toMatchObject({ target: 'history', level: 0, first: cursor });
      for (let row = 0; row < tile.rows; row++) {
        expect(values[row]).toBe((cursor + row) / 100);
        expect(values[tile.rows + row * 10000 + 9999]).toBe(value(cursor + row, 9999));
      }
      cursor += tile.rows;
    }
    expect(cursor).toBe(1001);
  }
});

it('covers partial pyramid boundaries whole, and no bucket spans more than a pixel', async () => {
  const store = storeOf(['c']), range: TimeRange = [.03, 10];
  let query: SummaryQuery = { columns: ['c'], range, resolution: 12, maxBytes: 4096 }, previous = 0;
  const sealed = new Set<number>();
  for (const count of [63, 64, 65, 511, 512, 513, 959, 960, 961, 1001]) {
    await store.append(rowsOf(previous, count, 1, 100, i => Math.sin(i / 100)));
    const summary = read(store, query), edges = new Set<number>();
    query = { ...query, cursor: summary.cursor };
    if (summary.reset) sealed.clear();
    for (const { tile, values } of summary.pages) {
      const span = 8 ** tile.level;
      for (let row = tile.first * span; row < (tile.first + tile.rows) * span; row++) {
        expect(sealed.has(row), `row ${row} is sent twice`).toBe(false);
        (tile.target === 'history' ? sealed : edges).add(row);
      }
      if (tile.level > 0) for (let i = 0; i < tile.rows; i++) expect(values[tile.rows + i]! - values[i]!).toBeLessThanOrEqual((10 - .03) / 12);
    }
    const [first, last] = store.interval(store.extent, range);
    for (let row = first; row < last; row++) expect(sealed.has(row) || edges.has(row), `row ${row} of [${first}, ${last})`).toBe(true);
    expect(sealed.size + edges.size).toBe(last - first);
    previous = count;
  }
});

it('never repeats history as a run grows', async () => {
  const columns = names(243), store = storeOf(columns);
  let query: SummaryQuery = { columns, range: null, resolution: 64, maxBytes: 4 * 1024 * 1024 }, previous = 0;
  const entries = new Set<string>();
  for (const count of [1, 40, 64, 65, 500, 1000, 1100, 1900, 20000]) {
    await store.append(rowsOf(previous, count, 243, 1000, (i, c) => Math.sin(i / 1000) + c));
    const summary = read(store, query);
    query = { ...query, cursor: summary.cursor };
    if (summary.reset) entries.clear();
    for (const { tile } of summary.pages) {
      expect((tile.first + tile.rows) * 8 ** tile.level).toBeLessThanOrEqual(count);
      if (tile.target !== 'history') continue;
      for (let index = tile.first; index < tile.first + tile.rows; index++) {
        const key = `${tile.level}:${index}`;
        expect(entries.has(key), `${key} is sent twice`).toBe(false);
        entries.add(key);
      }
    }
    previous = count;
  }
  const again = read(store, query);
  expect(again.reset).toBe(false);
  expect(again.tiles.every(tile => tile.target === 'edge')).toBe(true);
});

it('keeps actual levels at arbitrary viewport edges', async () => {
  const store = storeOf(['c']);
  await store.append(rowsOf(0, 10000, 1, 1, i => i));
  let cursor = 3;
  for (const tile of tiles('history', 3, 9997, 4, 1, 4096)) {
    const span = 8 ** tile.level, values = store.planes(tile.level, tile.first, tile.rows, [0]);
    expect(tile.first * span).toBe(cursor);
    expect(values[0]).toBe(tile.first * span);
    if (tile.kind === 'envelope') expect(values[tile.rows]! - values[0]!).toBe(span - 1);
    cursor += tile.rows * span;
  }
  expect(cursor).toBe(9997);
});

it('reads every Nth row as it says', async () => {
  const store = storeOf(names(3));
  await store.append(rowsOf(0, 100, 3, 1, (i, c) => i * 10 + c));
  expect([...store.sampled(5, 3, 10, [2, 0])]).toEqual([5, 15, 25, 52, 50, 152, 150, 252, 250]);
});

it('refuses a budget too small or a selection too wide', () => {
  const store = storeOf(names(300)), one = ['c0'];
  for (const query of [{ resolution: 0, maxBytes: 4096 }, { resolution: 65537, maxBytes: 4096 }, { resolution: 1, maxBytes: 4095 },
    { resolution: 1, maxBytes: (64 << 20) + 1 }, { resolution: 1, maxBytes: 4096, range: [2, 1] as const }]) {
    expect(() => checkSummary(store, { columns: one, range: null, ...query })).toThrow();
  }
  expect(() => checkSummary(store, { columns: names(300), range: null, resolution: 1, maxBytes: 4096 })).toThrow('too wide');
  expect(() => checkSummary(store, { columns: [], range: null, resolution: 1, maxBytes: 4096 })).toThrow('Choose');
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
      : question.op === 'summary' ? local.summary(run, question.query) : { header: {}, parts: local.csv(run) });
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
  const summary = await results.summary({ columns: ['v'], range: null, resolution: 100, maxBytes: 4096 }, signal), pages = [];
  for await (const page of summary.pages()) pages.push(page);
  expect(summary).toMatchObject({ state: 'completed', reset: true, tiles: [{ target: 'history', kind: 'samples', level: 0, first: 0, rows: 2 } satisfies TileDescription] });
  expect([...(pages[0]!.block as { values: Float64Array }).values]).toEqual([1.1, 0.7]);
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
    serve(async (_options, report) => wasmBackend({ files: async () => ({ open: async () => memory(), remove: async () => {} }), gridkit: standIn }, report), port2);
    return (await client(port1, {}))!;
  },
  quick: study(1),
  long: study(Infinity),
}, 10_000);
