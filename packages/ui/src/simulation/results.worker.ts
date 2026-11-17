import { Patch } from 'latkit';
import { isTerminal, openReader, type Cursor, type ResultReader, type RunState, type SummaryReply, type Tile, type TimeRange } from '@gridkit/solver';
import { affine, type Affine, type Basis } from '../domain/measure.js';
import type { ResultsCommand, ResultsMessage, ResultsReply } from './results.js';
import type { NetworkPlan } from './recording-plan.js';

/** How often a feed that has caught up asks for more. */
const interval = 1000 / 30;

/** What the network draws, from the start, with reads and transfers bounded independently of its width. */
export interface NetworkFeed {
  readonly kind: 'network';
  readonly plan: NetworkPlan;
  /** Every Nth row, where the whole run would not fit. */
  readonly every: number;
  readonly maxBytes: number;
}
/** What the plot draws: `columns` over a time range, at the resolution of its pixels. */
export interface PlotFeedRequest {
  readonly kind: 'plot';
  readonly columns: readonly string[];
  readonly basis: Basis;
  readonly reference: number | null;
  readonly range: TimeRange;
  readonly resolution: number;
  readonly maxBytes: number;
}
export type FeedRequest = NetworkFeed | PlotFeedRequest;
interface Revision {
  rows: number;
  state: RunState;
  range: TimeRange | null;
}
export interface NetworkPage extends Revision {
  bytes: Uint8Array;
  /** Byte offset and total size of this fragment's LATK patch. */
  offset: number;
  length: number;
  begin: boolean;
  reset: boolean;
  complete: boolean;
}
/** One tile of a plot's update, which commits as a whole: history first, sealed for the next update, then the edges around it. */
export interface PlotPage extends Revision {
  history: Uint8Array;
  edges: Uint8Array;
  begin: boolean;
  reset: boolean;
  seal: boolean;
  complete: boolean;
}

/** The values each plotted column's measure is taken from, by column. */
type References = ReadonlyMap<string, number>;
/**
 * Converts once to the renderer's Float32. latkit envelopes hold all minima, then all maxima. Each plane holds its columns in
 * turn, and `shifts` holds one for each.
 */
function valuesOf(planes: Float64Array[], shifts?: readonly Affine[]) {
  const values = new Float32Array(planes.reduce((size, plane) => size+plane.length, 0));
  let offset = 0;
  for (const plane of planes) for (let i = 0; i < plane.length; i++) {
    const shift = shifts?.[i % shifts.length];
    values[offset++] = shift ? (plane[i]! - shift.offset) * shift.scale : plane[i]!;
  }
  return values;
}
export function addTile(patch: Patch, { level, first, block }: Pick<Tile, 'level' | 'first' | 'block'>, shift?: (column: string) => Affine) {
  const shifts = shift && block.columns.map(shift);
  if (block.kind === 'samples') {
    patch.frames('Trace', 'value', { level, first, at: block.times, values: valuesOf([block.values], shifts) });
  } else {
    const at = new Float64Array(block.starts.length * 2);
    for (let i = 0; i < block.starts.length; i++) { at[2*i] = block.starts[i]!; at[2*i+1] = block.ends[i]!; }
    patch.frames('Trace', 'value', { level, first, at, values: valuesOf([block.minimum, block.maximum], shifts) });
  }
}

/** Tiles of `columns` as a plot page; `flags` say where the page falls in its update. */
export function packPlot(columns: readonly string[], tiles: readonly Tile[], basis: Basis, references: References | undefined,
  flags: Revision & Pick<PlotPage, 'begin' | 'reset' | 'seal' | 'complete'>): PlotPage {
  const history = new Patch('simulation-plot').axis('Time', 's'), edges = new Patch('simulation-plot');
  if (flags.reset) history.replace('Trace', columns, { series: Float32Array.from(columns, (_, i) => i) });
  const shift = basis === 'value' ? undefined : (column: string) => affine(basis, references?.get(column) ?? NaN);
  for (const tile of tiles) addTile(tile.target === 'history' ? history : edges, tile, shift);
  return { history: history.toBytes(), edges: edges.toBytes(), ...flags };
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, interval);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Each column's last value at or before `reference`, or its first without one. */
async function referencesOf(reader: ResultReader, columns: readonly string[], reference: number | null, signal: AbortSignal): Promise<References> {
  const { samples } = await reader.rows({ columns, at: reference ?? -Number.MAX_VALUE, count: 1, maxBytes: 8 * (1 + columns.length) }, signal);
  return new Map(samples.columns.map((column, index) => [column, samples.values[index] ?? NaN]));
}

/** A complete patch can exceed a packet when one field is wide; its byte fragments never do. */
function* networkFragments(bytes: Uint8Array, revision: Revision, maxBytes: number,
  flags: Pick<NetworkPage, 'begin' | 'reset' | 'complete'>): Generator<NetworkPage> {
  for (let offset = 0; offset < bytes.length; offset += maxBytes) yield { ...revision, ...flags,
    begin: flags.begin && offset === 0, reset: flags.reset && offset === 0,
    complete: flags.complete && offset + maxBytes >= bytes.length,
    bytes: bytes.slice(offset, offset + maxBytes), offset, length: bytes.length };
}

/** Shards read the same immutable sample indices, even while the recording grows between reads. */
export async function* networkPages(reader: ResultReader, { plan, every, maxBytes }: NetworkFeed, signal: AbortSignal): AsyncGenerator<NetworkPage> {
  const maxColumns = Math.floor(maxBytes / 8) - 1;
  if (maxColumns < 1 || maxBytes > 8 * 1024 * 1024) throw new RangeError('Invalid network packet budget.');
  const fields = plan.tables.flatMap(table => table.fields.map(field => ({ table, field })));
  if (!fields.length) return;
  const firstEntries = fields[0]!.field.entries.slice(0, maxColumns);
  const width = Math.min(maxColumns, Math.max(...fields.map(({ field }) => field.entries.length)));
  const count = Math.max(1, Math.min(4096, Math.floor(maxBytes / plan.bytesPerFrame), Math.floor(maxBytes / (8 * (width + 1)))));
  let from = 0;
  while (true) {
    signal.throwIfAborted();
    const { rows, state, range, samples } = await reader.rows({ columns: firstEntries.map(entry => plan.columns[entry.column]!),
      from, every, count, wait: true, maxBytes }, signal);
    if (samples.times.length) {
      const revision = { rows, state, range }, reset = from === 0;
      let begin = true;
      if (reset) for (const table of plan.tables) {
        const empty = new Patch('simulation').axis('Time', 's').replace(table.name, [], {}).toBytes();
        yield* networkFragments(empty, revision, maxBytes, { begin, reset: begin, complete: false });
        begin = false;
        for (let offset = 0; offset < table.ids.length; offset += 8192) {
          const ids = table.ids.slice(offset, offset + 8192);
          yield* networkFragments(new Patch('simulation').set(table.name, ids, {}).toBytes(), revision, maxBytes,
            { begin: false, reset: false, complete: false });
        }
      }
      for (let index = 0; index < fields.length; index++) {
        const { table, field } = fields[index]!, values = new Float32Array(samples.times.length * table.ids.length).fill(NaN);
        for (let offset = 0; offset < field.entries.length; offset += maxColumns) {
          const entries = field.entries.slice(offset, offset + maxColumns), columns = entries.map(entry => plan.columns[entry.column]!);
          const block = index === 0 && offset === 0 ? samples : (await reader.rows({ columns,
            from: samples.first, every, count: samples.times.length, maxBytes }, signal)).samples;
          if (block.first !== samples.first || block.times.length !== samples.times.length ||
            block.times.some((at, i) => at !== samples.times[i]) || block.values.length !== block.times.length * columns.length)
            throw new Error('The recording changed its committed sample rows.');
          entries.forEach(({ row }, column) => {
            for (let i = 0; i < block.times.length; i++) values[i * table.ids.length + row] = block.values[i * columns.length + column]!;
          });
        }
        const patch = new Patch('simulation').frames(table.name, field.name,
          { first: samples.first / every, at: samples.times, values });
        yield* networkFragments(patch.toBytes(), revision, maxBytes, { begin, reset: false, complete: index === fields.length - 1 });
        begin = false;
      }
      from = samples.first + samples.times.length * every;
    }
    if (from >= rows) {
      if (isTerminal(state)) return;
      await pause(signal);
    }
  }
}

/** The plot's tiles: each update says what extends the history this reader holds, then replaces the edges around it. */
export async function* plotPages(reader: ResultReader, { columns, basis, reference, range, resolution, maxBytes }: PlotFeedRequest, signal: AbortSignal): AsyncGenerator<PlotPage> {
  let cursor: Cursor | null = null, after: number | undefined, references: References | undefined;
  while (true) {
    const reply: SummaryReply = await reader.summary({ columns, range, resolution, maxBytes, cursor, ...after === undefined ? {} : { after } }, signal);
    const { rows, state, range: covered, reset, tiles } = reply, revision = { rows, state, range: covered };
    if (basis !== 'value' && tiles.length) references ??= await referencesOf(reader, columns, reference, signal);
    const sealed = tiles.map(tile => tile.target).lastIndexOf('history');
    // Even an update with no new history is sealed; an empty page carries it.
    if (sealed < 0) yield packPlot(columns, [], basis, references, { ...revision, begin: true, reset, seal: true, complete: !tiles.length });
    let index = 0;
    for await (const tile of reply.pages()) {
      const begin = sealed >= 0 && index === 0;
      yield packPlot(columns, [tile], basis, references, { ...revision, begin, reset: begin && reset, seal: index === sealed, complete: index === tiles.length - 1 });
      index++;
    }
    cursor = reply.cursor; after = rows;
    if (isTerminal(state)) return;
    await pause(signal);
  }
}

/** What a run's results worker serves: one reader of the run, and each feed of it a page at a time, as each is asked. */
export class ResultHost {
  #reader: ResultReader | undefined;
  #feeds = new Map<number, { pages: AsyncGenerator<NetworkPage | PlotPage>; abort: AbortController }>();
  constructor(private open: (port: MessagePort) => ResultReader) {}
  async handle(command: ResultsCommand): Promise<NetworkPage | PlotPage | null> {
    switch (command.kind) {
      case 'open':
        this.close();
        this.#reader = this.open(command.port);
        return null;
      case 'follow': {
        this.#stop(command.feed);
        if (!this.#reader) throw new Error('No results to read.');
        const abort = new AbortController(), { request } = command;
        this.#feeds.set(command.feed, { abort, pages: request.kind === 'network' ? networkPages(this.#reader, request, abort.signal) : plotPages(this.#reader, request, abort.signal) });
        return null;
      }
      case 'next': {
        const feed = this.#feeds.get(command.feed);
        if (!feed) throw new Error('No result feed.');
        const next = await feed.pages.next();
        return next.done ? null : next.value;
      }
      case 'stop':
        this.#stop(command.feed);
        return null;
    }
  }
  #stop(id: number) {
    const feed = this.#feeds.get(id);
    if (!feed) return;
    this.#feeds.delete(id);
    feed.abort.abort();
    void feed.pages.return(undefined).catch(() => {});
  }
  /** Stops every feed, and lets the run's port go. */
  close() {
    for (const id of [...this.#feeds.keys()]) this.#stop(id);
    this.#reader?.close();
    this.#reader = undefined;
  }
}
/** The buffers a page gives up, moved to the main thread rather than copied. */
export const transferOf = (page: NetworkPage | PlotPage | null) =>
  (!page ? [] : 'bytes' in page ? [page.bytes.buffer] : [page.history.buffer, page.edges.buffer]).filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);

// Inside the worker: commands in order, each answered once; closing lets the run's port go before the worker ends.
if ('WorkerGlobalScope' in globalThis) {
  const host = new ResultHost(openReader);
  self.onmessage = async ({ data }: MessageEvent<ResultsMessage>) => {
    if (data.kind === 'close') { host.close(); self.close(); return; }
    try {
      const value = await host.handle(data);
      self.postMessage({ id: data.id, value } satisfies ResultsReply, { transfer: transferOf(value) });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      self.postMessage({ id: data.id, error: { name: error.name, message: error.message,
        ...('code' in error && typeof error.code === 'string' && { code: error.code }) } } satisfies ResultsReply);
    }
  };
}
