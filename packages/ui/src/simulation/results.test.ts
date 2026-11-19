import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Data, load } from 'latkit';
import type { EntriesQuery, Envelope, ResultReader, RowsQuery, RunState, Samples } from '@gridkit/solver';
import { plotDataset } from './plot.js';
import { RunResults, type ResultsMessage, type ResultsReply } from './results.js';
import { networkPages, ResultHost, type NetworkFeed, type TileSet } from './results.worker.js';
import { networkPlan } from './recording-plan.js';
import { RecordingBuffer } from './recording-buffer.js';

beforeAll(async () => { await load({ wasm: await WebAssembly.compile(new Uint8Array(await readFile(new URL(import.meta.resolve('latkit/wasm'))))) }); });
afterEach(() => vi.unstubAllGlobals());

class WorkerStub {
  static instance: WorkerStub;
  messages: ResultsMessage[] = [];
  onmessage?: (event: { data: ResultsReply }) => void;
  onerror?: (event: ErrorEvent) => void;
  onmessageerror?: () => void;
  terminated = false;
  constructor() { WorkerStub.instance = this; }
  postMessage(message: ResultsMessage) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  /** Answers the last `kind` asked, of `feed` where given. */
  reply(kind: ResultsMessage['kind'], value: unknown = null, feed?: number) {
    const message = this.messages.filter(message => message.kind === kind && (feed === undefined || ('feed' in message && message.feed === feed))).at(-1)!;
    this.onmessage?.({ data: { id: (message as { id: number }).id, value } });
  }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const feed: NetworkFeed = { plan: networkPlan([]), every: 1, maxBytes: 4096 };
function facade() {
  vi.stubGlobal('Worker', WorkerStub);
  const { port1 } = new MessageChannel();
  return { results: new RunResults(Promise.resolve(port1), 1), stub: WorkerStub.instance, port: port1 };
}
const kinds = (stub: WorkerStub) => stub.messages.map(message => message.kind);
/** A worker script that could not load, as the browser reports one: an error with no message. */
const unloaded = (stub: WorkerStub) => stub.onerror?.({ message: '', preventDefault() {} } as ErrorEvent);

it("reports a failed result-worker load and lets another run use a fresh worker", async () => {
  const first = facade();
  unloaded(first.stub);
  await expect(first.results.follow(feed, new AbortController().signal, () => {})).rejects.toThrow("This run's results could not be read.");
  expect(first.stub.terminated).toBe(true);
  const second = facade();
  expect(second.stub).not.toBe(first.stub);
  unloaded(second.stub);
  await expect(second.results.follow(feed, new AbortController().signal, () => {})).rejects.toThrow("This run's results could not be read.");
  first.port.close(); second.port.close();
});

it('opens the run\'s port once, pulls a page only once the last is applied, and stops each feed with its reader', async () => {
  const { results, stub, port } = facade(), abort = new AbortController();
  let release!: () => void;
  const applied = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const following = results.follow(feed, abort.signal, applied);
  await flush();
  expect(stub.messages[0]).toMatchObject({ kind: 'open', port, width: 1 });
  stub.reply('open'); await flush();
  expect(stub.messages[1]).toMatchObject({ kind: 'follow', feed: 0, request: feed });
  stub.reply('follow'); await flush();
  stub.reply('next', { bytes: new Uint8Array() }); await flush();
  expect(applied).toHaveBeenCalledOnce();
  expect(kinds(stub)).toEqual(['open', 'follow', 'next']);
  release(); await flush();
  expect(kinds(stub)).toEqual(['open', 'follow', 'next', 'next']);
  stub.reply('next', null);
  await following;
  expect(stub.messages.at(-1)).toMatchObject({ kind: 'stop', feed: 0 });
  results.close();
  expect(stub.messages.at(-1)).toEqual({ kind: 'close' });
});

it('follows feeds side by side: a late page of an aborted one is ignored, and stopping it leaves the other going', async () => {
  const { results, stub } = facade(), abort = new AbortController(), apply = vi.fn(), other = vi.fn();
  const first = results.follow(feed, abort.signal, apply);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await flush(); stub.reply('open'); await flush(); stub.reply('follow', null, 0); await flush();
  const second = results.follow(feed, new AbortController().signal, other);
  await flush(); stub.reply('follow', null, 1); await flush();
  abort.abort(); await rejected; await flush();
  expect(stub.messages.filter(message => message.kind === 'stop')).toEqual([expect.objectContaining({ feed: 0 })]);
  stub.reply('next', { bytes: new Uint8Array() }, 0); await flush();
  expect(apply).not.toHaveBeenCalled();
  stub.reply('next', { bytes: new Uint8Array() }, 1); await flush();
  expect(other).toHaveBeenCalledOnce();
  void second.catch(() => {});
  results.close();
});

it('keeps one Tiles per set, each at an address of its own', () => {
  const { results } = facade(), shown = results.tiles(set);
  expect(results.tiles(set)).toBe(shown);
  expect(shown.name).toBe(plotDataset);
  expect(results.tiles({ ...set, basis: 'change' }).url).not.toBe(shown.url);
  results.close();
});

it('rejects what is pending on a worker fault, and everything after', async () => {
  const { results, stub } = facade();
  const pending = results.follow(feed, new AbortController().signal, () => {});
  const rejected = expect(pending).rejects.toThrow('Cannot decode');
  await flush(); stub.onmessageerror!(); await rejected;
  expect(stub.terminated).toBe(true);
  await expect(results.follow(feed, new AbortController().signal, () => {})).rejects.toThrow('Cannot decode');
});

const revision = { rows: 4, state: 'running' as RunState, range: [0, 3] as const };
const samples = (first: number, times: number[], values = times, columns = ['v']): Samples => ({ kind: 'samples', first, columns, times: Float64Array.from(times), values: Float64Array.from(values) });
const noRows = async () => { throw new Error('Unexpected rows.'); };
const noEntries = async () => { throw new Error('Unexpected entries.'); };
/** A reader answering as `reader` says, and nothing else. */
const readerOf = (reader: Partial<ResultReader>): ResultReader => ({ rows: noRows, entries: noEntries, close() {}, ...reader });
const bus = [{ column: 'v', element: { collection: 'buses' as const, id: 'bus' }, output: 'Vm', label: 'Voltage', unit: 'p.u.' }];
async function drain<T>(pages: AsyncGenerator<T>) { const out = []; for await (const page of pages) out.push(page); return out; }

it('reads the network from its first row to the run\'s last, resetting only at the start', async () => {
  const replies = [
    { rows: 3, state: 'running' as RunState, range: [0, 2] as const, samples: samples(0, [0, 1, 2]) },
    { rows: 4, state: 'running' as RunState, range: [0, 3] as const, samples: samples(3, [3]) },
    { rows: 4, state: 'completed' as RunState, range: [0, 3] as const, samples: samples(4, []) },
  ];
  const rows = vi.fn(async (_query: RowsQuery) => replies.shift()!);
  const pages = await drain(networkPages(readerOf({ rows }), { ...feed, plan: networkPlan(bus), maxBytes: 64 }, new AbortController().signal));
  expect(rows.mock.calls.map(([query]) => [query.from, query.wait, query.every, query.maxBytes])).toEqual([[0, true, 1, 64], [3, true, 1, 64], [4, true, 1, 64]]);
  const data = new Data('simulation'), buffer = new RecordingBuffer(data);
  try {
    for (const page of pages) buffer.apply(page);
    expect(pages.filter(page => page.complete)).toHaveLength(2);
    expect(data.describe().span).toEqual([0, 3]);
    expect(data.get('Bus', 'bus', 'Vm', { at: 2 })).toBe(2);
    expect(data.get('Bus', 'bus', 'Vm', { at: 3 })).toBe(3);
  } finally { buffer.destroy(); data.destroy(); }
});

it('steps by every Nth row, where the whole run would not fit', async () => {
  const replies = [{ ...revision, rows: 7, samples: samples(0, [0, 3]) }, { ...revision, rows: 7, state: 'completed' as RunState, samples: samples(6, [6]) }];
  const rows = vi.fn(async (_query: RowsQuery) => replies.shift()!);
  await drain(networkPages(readerOf({ rows }), { ...feed, plan: networkPlan(bus), every: 3 }, new AbortController().signal));
  expect(rows.mock.calls.map(([query]) => query.from)).toEqual([0, 6]);
});

it('installs each output as recorded, one field per output however many elements record it', async () => {
  const both = [...bus, { column: 'w', element: { collection: 'buses' as const, id: 'other' }, output: 'Vm', label: 'Other', unit: 'p.u.' }];
  const data = new Data('simulation'), buffer = new RecordingBuffer(data);
  try {
    const rows = async () => ({ rows: 2, state: 'completed' as const, range: [0, 1] as const, samples: samples(0, [0, 1], [1, 2, 0.75, 1.5], ['v', 'w']) });
    for await (const page of networkPages(readerOf({ rows }), { ...feed, plan: networkPlan(both) }, new AbortController().signal)) buffer.apply(page);
    expect(data.describe().tables[0]!.fields.map(field => field.name)).toEqual(['Vm']);
    expect(data.get('Bus', 'bus', 'Vm', { at: 1 })).toBe(0.75);
    expect(data.get('Bus', 'other', 'Vm', { at: 1 })).toBe(1.5);
  } finally { buffer.destroy(); data.destroy(); }
});

it('joins reordered channels by identity, keeping equal-time event rows', async () => {
  const network = ['b', 'a'].map((id, index) => ({ column: String(index), element: { collection: 'buses' as const, id }, output: 'Vm', label: id, unit: 'p.u.' }));
  const data = new Data('simulation'), buffer = new RecordingBuffer(data);
  try {
    const blocks = [samples(0, [0, 1], [1, 10, 2, 20], ['0', '1']), samples(2, [1, 2], [4, 40, 3, 30], ['0', '1'])];
    const rows = async () => ({ rows: 4, state: 'completed' as const, range: [0, 2] as const, samples: blocks.shift()! });
    for await (const page of networkPages(readerOf({ rows }), { ...feed, plan: networkPlan(network) }, new AbortController().signal)) buffer.apply(page);
    expect(data.get('Bus', 'a', 'Vm', { at: 1 })).toBe(40);
    expect(data.get('Bus', 'b', 'Vm', { at: 2 })).toBe(3);
    expect(data.get('Bus', 'a', 'Vm', { at: 0 })).toBe(10);
  } finally { buffer.destroy(); data.destroy(); }
});

it('shards wide reads and transfers, publishes whole revisions, and preserves equal-time samples', async () => {
  const channels = Array.from({ length: 20 }, (_, i) => ({ ...bus[0]!, column: String(i), element: { collection: 'buses' as const, id: `b${i}` } }));
  const times = [0, 1, 1], queries: RowsQuery[] = [];
  const reader = readerOf({ rows: async query => {
    queries.push(query);
    const first = query.from ?? 0, count = Math.min(query.count ?? 3, Math.floor(query.maxBytes / (8 * (query.columns.length + 1))), times.length - first);
    return { rows: 3, state: 'completed', range: [0, 1], samples: samples(first, times.slice(first, first + count),
      Array.from({ length: count * query.columns.length }, (_, index) => (first + Math.floor(index / query.columns.length)) * 100 + Number(query.columns[index % query.columns.length])), [...query.columns]) };
  } });
  const data = new Data('simulation'), buffer = new RecordingBuffer(data);
  let commits = 0;
  try {
    for await (const page of networkPages(reader, { ...feed, plan: networkPlan(channels), maxBytes: 64 }, new AbortController().signal)) {
      expect(page.bytes.byteLength).toBeLessThanOrEqual(64);
      buffer.apply(page);
      if (page.complete) commits++;
      expect(data.get('Bus', 'b19', 'Vm', { at: 1 })).toBe(commits ? (commits - 1) * 100 + 19 : null);
    }
    expect(commits).toBe(3);
    expect(data.get('Bus', 'b19', 'Vm', { at: 1 })).toBe(219);
    expect(queries.every(query => query.columns.length <= 7)).toBe(true);
  } finally { buffer.destroy(); data.destroy(); }
});

it('serves a run\'s feeds side by side, stops each alone, and lets the run\'s port go', async () => {
  const signals: AbortSignal[] = [], close = vi.fn();
  const reader = readerOf({ close, rows: async (_query, signal) => { signals.push(signal!); return new Promise((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))); } });
  const host = new ResultHost(() => reader), network = { ...feed, plan: networkPlan(bus) }, { port1 } = new MessageChannel();
  await host.handle({ kind: 'open', port: port1, width: 1 });
  await host.handle({ kind: 'follow', feed: 0, request: network });
  await host.handle({ kind: 'follow', feed: 1, request: network });
  const first = host.handle({ kind: 'next', feed: 0 }), rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  void host.handle({ kind: 'next', feed: 1 }).catch(() => {});
  await flush();
  await host.handle({ kind: 'stop', feed: 0 });
  await rejected;
  expect(signals.map(signal => signal.aborted)).toEqual([true, false]);
  await expect(host.handle({ kind: 'next', feed: 0 })).rejects.toThrow('No result feed');
  host.close();
  expect(signals[1]!.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

const set: TileSet = { columns: ['v'], basis: 'value', reference: null };
const envelope = (columns: string[], starts: number[], ends: number[], minimum: number[], maximum: number[]): Envelope => ({ kind: 'envelope', columns,
  starts: Float64Array.from(starts), ends: Float64Array.from(ends), minimum: Float64Array.from(minimum), maximum: Float64Array.from(maximum) });
/** A results worker's host of `reader`, its run's port open: a run of `width` columns. */
async function hosting(reader: ResultReader, width = 2) {
  const host = new ResultHost(() => reader), { port1 } = new MessageChannel();
  await host.handle({ kind: 'open', port: port1, width });
  return host;
}
const file = async (host: ResultHost, shown: TileSet, path: string) => await host.handle({ kind: 'tile', set: shown, path }) as Uint8Array;
/** The plot's dataset as latkit draws `shown` from `paths`, over its base. */
async function drawn(host: ResultHost, shown: TileSet, paths: string[]) {
  const data = new Data(plotDataset);
  for (const path of ['base.latk', ...paths]) data.apply(await file(host, shown, path));
  return data;
}
/** The least and greatest the plot draws of `shown`'s first coarse span. */
async function extent(host: ResultHost, shown: TileSet) {
  const data = await drawn(host, shown, ['1/0.latk']);
  try {
    const { least, greatest } = data.envelope({ table: 'Trace', field: 'value', range: [0, 7], spans: 1 });
    return [...least, ...greatest];
  } finally { data.destroy(); }
}

it('describes a set\'s time tiles: each level the run holds a whole entry of, in spans near 1 MiB of its rows', async () => {
  const reader = readerOf({ rows: async query => ({ rows: 600, state: 'running', range: [0, 5.99], samples: samples(0, [0], [1], [...query.columns]) }) });
  const manifest = async (width: number) => {
    const host = await hosting(reader, width);
    try { return JSON.parse(new TextDecoder().decode(await file(host, set, 'frames.json'))); } finally { host.close(); }
  };
  expect(await manifest(1)).toEqual({ data: 'base.latk', chunk: 131072, url: '{level}/{index}.latk', frames: [{ table: 'Trace', field: 'value', levels: 3, frames: [0, 600] }] });
  // A plot of one series reads few rows of a wide run a span: the solver reads them whole.
  expect((await Promise.all([2000, 70000].map(manifest))).map(({ chunk }) => chunk)).toEqual([64, 8]);
});

it.each([1, 2])('writes spans latkit draws as the solver keeps level %i: extrema and gaps per series', async level => {
  const span = 8 ** level, queries: EntriesQuery[] = [];
  const host = await hosting(readerOf({ entries: async query => {
    queries.push(query);
    return { ...revision, block: envelope(['a', 'b'], [0, span, 2*span], [span-1, 2*span-1, 3*span-1], [1, 10, NaN, NaN, 5, 50], [2, 20, NaN, NaN, 6, 60]) };
  } }));
  const data = await drawn(host, { ...set, columns: ['a', 'b'] }, [`${level}/0.latk`]);
  try {
    const read = data.envelope({ table: 'Trace', field: 'value', range: [0, 3*span], spans: 3 });
    expect([...read.least]).toEqual([1, NaN, 5, 10, NaN, 50]);
    expect([...read.greatest]).toEqual([2, NaN, 6, 20, NaN, 60]);
  } finally { data.destroy(); host.close(); }
  // A span of two series is 65,536 entries, its least and greatest of each.
  expect(queries).toEqual([{ columns: ['a', 'b'], level, first: 0, count: 65536, maxBytes: 16 * 65536 * 3 }]);
});

it('colors each series as its set says, or by its place', async () => {
  const host = await hosting(readerOf({}));
  for (const [series, colors] of [[undefined, [0, 1]], [[3, 0], [3, 0]]] as const) {
    const data = await drawn(host, { ...set, columns: ['a', 'b'], ...series && { series } }, []);
    try { expect(['a', 'b'].map(id => data.get('Trace', id, 'series'))).toEqual(colors); } finally { data.destroy(); }
  }
  host.close();
});

it('measures a trace from its reference in full precision, reading the reference once for its set', async () => {
  const pressure = 4885576.181472959, references: RowsQuery[] = [];
  const host = await hosting(readerOf({
    rows: async query => { references.push(query); return { ...revision, samples: samples(0, [0], [pressure]) }; },
    entries: async () => ({ ...revision, block: envelope(['v'], [0], [7], [pressure - 5], [pressure + 0.25]) }),
  }));
  // Float32 keeps only whole pascals here: as recorded, the quarter pascal is gone.
  expect(await extent(host, set)).toEqual([Math.fround(pressure - 5), Math.fround(pressure + 0.25)]);
  const change: TileSet = { ...set, basis: 'change', reference: 1.5 };
  expect(await extent(host, change)).toEqual([-5, 0.25]);
  expect(await extent(host, change)).toEqual([-5, 0.25]);
  expect(references).toEqual([expect.objectContaining({ columns: ['v'], at: 1.5, count: 1 })]);
  host.close();
});

it('keeps a span\'s order in percent, from a negative reference too', async () => {
  const host = await hosting(readerOf({ rows: async () => ({ ...revision, samples: samples(0, [0], [-2]) }),
    entries: async () => ({ ...revision, block: envelope(['v'], [0], [7], [-3], [-1]) }) }));
  expect(await extent(host, { ...set, basis: 'percent', reference: null })).toEqual([-50, 50]);
  host.close();
});
