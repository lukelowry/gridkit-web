import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Data, load, Patch } from 'latkit';
import type { ResultReader, RowsQuery, RunState, Samples, SummaryQuery, SummaryReply, Tile } from '@gridkit/solver';
import { PlotBuffer } from './plot.js';
import { RunResults, type ResultsMessage, type ResultsReply } from './results.js';
import { addTile, NetworkPacker, networkPages, packPlot, plotPages, ResultHost, type NetworkFeed, type PlotFeedRequest, type PlotPage } from './results.worker.js';

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
const feed: NetworkFeed = { kind: 'network', channels: [], every: 1, maxBytes: 4096 };
function facade() {
  vi.stubGlobal('Worker', WorkerStub);
  const { port1 } = new MessageChannel();
  return { results: new RunResults(Promise.resolve(port1)), stub: WorkerStub.instance, port: port1 };
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
  expect(stub.messages[0]).toMatchObject({ kind: 'open', port });
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
const never = async (): Promise<SummaryReply> => { throw new Error('Unexpected summary.'); };
const noRows = async () => { throw new Error('Unexpected rows.'); };
/** A reader answering as `reader` says, and nothing else. */
const readerOf = (reader: Partial<ResultReader>): ResultReader => ({ rows: noRows, summary: never, close() {}, ...reader });
const bus = [{ column: 'v', element: { collection: 'buses' as const, id: 'bus' }, output: 'Vm', label: 'Voltage', unit: 'p.u.' }];
async function drain<T>(pages: AsyncGenerator<T>) { const out = []; for await (const page of pages) out.push(page); return out; }

it('reads the network from its first row to the run\'s last, resetting only at the start', async () => {
  const replies = [
    { rows: 3, state: 'running' as RunState, range: [0, 2] as const, samples: samples(0, [0, 1, 2]) },
    { rows: 4, state: 'running' as RunState, range: [0, 3] as const, samples: samples(3, [3]) },
    { rows: 4, state: 'completed' as RunState, range: [0, 3] as const, samples: samples(4, []) },
  ];
  const rows = vi.fn(async (_query: RowsQuery) => replies.shift()!);
  const pages = await drain(networkPages(readerOf({ rows }), { ...feed, channels: bus, maxBytes: 64 }, new AbortController().signal));
  expect(rows.mock.calls.map(([query]) => [query.from, query.wait, query.every, query.maxBytes])).toEqual([[0, true, 1, 64], [3, true, 1, 64], [4, true, 1, 64]]);
  const data = new Data('simulation');
  try {
    for (const page of pages) data.apply(page.bytes);
    expect(pages).toHaveLength(2);
    expect(data.describe().span).toEqual([0, 3]);
    expect(data.get('buses', 'bus', 'Vm', { at: 2 })).toBe(2);
    expect(data.get('buses', 'bus', 'Vm', { at: 3 })).toBe(3);
  } finally { data.destroy(); }
});

it('steps by every Nth row, where the whole run would not fit', async () => {
  const replies = [{ ...revision, rows: 7, samples: samples(0, [0, 3]) }, { ...revision, rows: 7, state: 'completed' as RunState, samples: samples(6, [6]) }];
  const rows = vi.fn(async (_query: RowsQuery) => replies.shift()!);
  await drain(networkPages(readerOf({ rows }), { ...feed, channels: bus, every: 3 }, new AbortController().signal));
  expect(rows.mock.calls.map(([query]) => query.from)).toEqual([0, 6]);
});

it('installs each output as recorded, one field per output however many elements record it', () => {
  const both = [...bus, { column: 'w', element: { collection: 'buses' as const, id: 'other' }, output: 'Vm', label: 'Other', unit: 'p.u.' }];
  const packer = new NetworkPacker(both), data = new Data('simulation');
  try {
    data.apply(packer.pack(samples(0, [0, 1], [1, 2, 0.75, 1.5], ['v', 'w']), true));
    expect(data.describe().tables[0]!.fields.map(field => field.name)).toEqual(['Vm']);
    expect(data.get('buses', 'bus', 'Vm', { at: 1 })).toBe(0.75);
    expect(data.get('buses', 'other', 'Vm', { at: 1 })).toBe(1.5);
  } finally { data.destroy(); }
});

it('joins reordered channels by identity, keeping equal-time event rows', () => {
  const network = ['b', 'a'].map((id, index) => ({ column: String(index), element: { collection: 'buses' as const, id }, output: 'Vm', label: id, unit: 'p.u.' }));
  const packer = new NetworkPacker(network), data = new Data('simulation');
  try {
    data.apply(packer.pack(samples(0, [0, 1], [1, 10, 2, 20], ['0', '1']), true));
    data.apply(packer.pack(samples(2, [1, 2], [4, 40, 3, 30], ['0', '1']), false));
    expect(data.get('buses', 'a', 'Vm', { at: 1 })).toBe(40);
    expect(data.get('buses', 'b', 'Vm', { at: 2 })).toBe(3);
    expect(data.get('buses', 'a', 'Vm', { at: 0 })).toBe(10);
  } finally { data.destroy(); }
});

const plot: PlotFeedRequest = { kind: 'plot', columns: ['v'], basis: 'value', reference: null, range: [0, 8], resolution: 32, maxBytes: 4096 };
function summaryOf(state: RunState, reset: boolean, sealed: number, tiles: Tile[]): SummaryReply {
  return { rows: 9, state, range: [0, 8], reset, cursor: { level: 0, first: 0, sealed }, tiles: tiles.map(({ target, level, first }) => ({ target, kind: 'samples', level, first, rows: 1 })),
    async *pages() { yield* tiles; } };
}
const tile = (target: Tile['target'], first: number, value = first): Tile => ({ target, level: 0, first, block: samples(first, [first], [value]) });

it('marks where each tile falls in its update, and says what it holds on the next', async () => {
  const replies = [
    summaryOf('running', true, 2, [tile('history', 0), tile('history', 1), tile('edge', 2)]),
    summaryOf('completed', false, 2, [tile('edge', 2)]),
  ];
  const summary = vi.fn(async (_query: SummaryQuery) => replies.shift()!);
  const pages = await drain(plotPages(readerOf({ summary }), plot, new AbortController().signal));
  expect(pages.map(({ begin, reset, seal, complete }) => ({ begin, reset, seal, complete }))).toEqual([
    { begin: true, reset: true, seal: false, complete: false },
    { begin: false, reset: false, seal: true, complete: false },
    { begin: false, reset: false, seal: false, complete: true },
    // No new history: an empty page seals it, and begins what the edges finish.
    { begin: true, reset: false, seal: true, complete: false },
    { begin: false, reset: false, seal: false, complete: true },
  ]);
  expect(summary.mock.calls[0]![0]).toMatchObject({ cursor: null });
  expect(summary.mock.calls[0]![0]).not.toHaveProperty('after');
  expect(summary.mock.calls[1]![0]).toMatchObject({ cursor: { level: 0, first: 0, sealed: 2 }, after: 9 });
});

it('finishes an update that holds nothing at all', async () => {
  const pages = await drain(plotPages(readerOf({ summary: async () => summaryOf('completed', true, 0, []) }), plot, new AbortController().signal));
  expect(pages).toHaveLength(1);
  expect(pages[0]).toMatchObject({ begin: true, reset: true, seal: true, complete: true });
});

it('reads the reference once, at its time, then shows each trace from it', async () => {
  const replies = [summaryOf('running', true, 0, [tile('edge', 0, 10)]), summaryOf('completed', false, 0, [tile('edge', 1, 11)])];
  const rows = vi.fn(async (_query: RowsQuery) => ({ ...revision, samples: samples(0, [0], [10]) }));
  const pages = await drain(plotPages(readerOf({ rows, summary: async () => replies.shift()! }), { ...plot, basis: 'change', reference: 1.5 }, new AbortController().signal));
  const data = new Data('simulation-plot'), buffer = new PlotBuffer(data), shown: unknown[] = [];
  try {
    for (const page of pages) if (buffer.apply(page)) shown.push(data.get('Trace', 'v', 'value', { at: shown.length }));
  } finally { buffer.destroy(); data.destroy(); }
  expect(shown).toEqual([0, 1]);
  expect(rows).toHaveBeenCalledOnce();
  expect(rows.mock.calls[0]![0]).toMatchObject({ columns: ['v'], at: 1.5, count: 1 });
});

it('serves a run\'s feeds side by side, stops each alone, and lets the run\'s port go', async () => {
  const signals: AbortSignal[] = [], close = vi.fn();
  const reader = readerOf({ close, rows: async (_query, signal) => { signals.push(signal!); return new Promise((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))); } });
  const host = new ResultHost(() => reader), network = { ...feed, channels: bus }, { port1 } = new MessageChannel();
  await host.handle({ kind: 'open', port: port1 });
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

const flags = { ...revision, begin: true, reset: true, seal: true, complete: true };
const envelope = (minimum: number, maximum: number): Tile => ({ target: 'history', level: 1, first: 0, block: { kind: 'envelope', columns: ['v'], starts: Float64Array.of(0), ends: Float64Array.of(7),
  minimum: Float64Array.of(minimum), maximum: Float64Array.of(maximum) } });
const edge = (value: number): Tile => ({ target: 'edge', level: 0, first: 8, block: samples(8, [8], [value]) });
/** The least and greatest a packed plot page draws. */
function extent(page: PlotPage) {
  const data = new Data('simulation-plot');
  try {
    data.apply(page.history).apply(page.edges);
    const { least, greatest } = data.envelope({ table: 'Trace', field: 'value', range: [0, 9], spans: 1 });
    return [Math.min(...least), Math.max(...greatest)];
  } finally { data.destroy(); }
}

it('shifts a trace in full precision, so a small change on a large value keeps its detail', () => {
  const pressure = 4885576.181472959, tiles = [envelope(pressure - 5, pressure), edge(pressure + 0.25)];
  // Float32 keeps only whole pascals here: as recorded, the quarter pascal is gone.
  expect(extent(packPlot(['v'], tiles, 'value', undefined, flags))).toEqual([Math.fround(pressure - 5), Math.fround(pressure + 0.25)]);
  expect(extent(packPlot(['v'], tiles, 'change', new Map([['v', pressure]]), flags))).toEqual([-5, 0.25]);
});

it('keeps a summary\'s order in percent, from a negative reference too', () => {
  expect(extent(packPlot(['v'], [envelope(-3, -1)], 'percent', new Map([['v', -2]]), flags))).toEqual([-50, 50]);
});

it.each([1, 2])('writes envelopes as latkit reads them, extrema and gaps per channel, at level %i', level => {
  const span = 8 ** level, data = new Data('trace');
  try {
    const patch = new Patch().replace('Trace', ['a', 'b'], {});
    addTile(patch, { level, first: 0, block: { kind: 'envelope', columns: ['a', 'b'],
      starts: Float64Array.of(0, span, 2*span), ends: Float64Array.of(span-1, 2*span-1, 3*span-1),
      minimum: Float64Array.of(1, 10, NaN, NaN, 5, 50), maximum: Float64Array.of(2, 20, NaN, NaN, 6, 60) } });
    data.apply(patch);
    const read = data.envelope({ table: 'Trace', field: 'value', range: [0, 3*span], spans: 3 });
    expect([...read.least]).toEqual([1, NaN, 5, 10, NaN, 50]);
    expect([...read.greatest]).toEqual([2, NaN, 6, 20, NaN, 60]);
  } finally { data.destroy(); }
});

it('reads an aligned coarse tile and a finer edge without inventing levels', () => {
  const data = new Data('mixed');
  try {
    const patch = new Patch().replace('Trace', ['a'], {});
    addTile(patch, { level: 2, first: 0, block: { kind: 'envelope', columns: ['a'],
      starts: Float64Array.of(0), ends: Float64Array.of(63), minimum: Float64Array.of(-10), maximum: Float64Array.of(10) } });
    addTile(patch, { level: 1, first: 8, block: { kind: 'envelope', columns: ['a'],
      starts: Float64Array.of(64), ends: Float64Array.of(71), minimum: Float64Array.of(-20), maximum: Float64Array.of(20) } });
    addTile(patch, { level: 0, first: 72, block: { kind: 'samples', first: 72, columns: ['a'], times: Float64Array.of(72), values: Float64Array.of(30) } });
    data.apply(patch);
    const read = data.envelope({ table: 'Trace', field: 'value', range: [0, 73], spans: 1 });
    expect(Math.min(...read.least)).toBe(-20);
    expect(Math.max(...read.greatest)).toBe(30);
  } finally { data.destroy(); }
});
