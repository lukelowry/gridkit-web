import type { Channel } from '@gridkit/library/gridkit';
import { Patch } from 'latkit';
import { isTerminal, openReader, type Cursor, type ResultReader, type RunState, type Samples, type SummaryReply, type Tile, type TimeRange } from '@gridkit/solver';
import { affine, type Affine, type Basis } from '../domain/measure.js';
import type { ResultsCommand, ResultsMessage, ResultsReply } from './results.js';

/** How often a feed that has caught up asks for more. */
const interval = 1000 / 30;

/** What the network draws: exact rows of `channels`, from the start, as recorded. Its measures read them in latkit. */
export interface NetworkFeed {
  readonly kind: 'network';
  readonly channels: readonly Channel[];
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
export interface NetworkPage extends Revision { bytes: Uint8Array }
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
type Scatter = Map<string, { column: number; row: number }[]>;
/** Packs rows as latkit patches. Row identities and column scatter plans are built once; values convert to the renderer's Float32. */
export class NetworkPacker {
  #tables: { name: string; ids: string[]; fields: Scatter }[];
  constructor(channels: readonly Channel[]) {
    const tables = new Map<string, { ids: string[]; rows: Map<string, number>; fields: Scatter }>();
    channels.forEach((channel, column) => {
      const name = channel.element.collection;
      let table = tables.get(name);
      if (!table) { table = { ids: [], rows: new Map(), fields: new Map() }; tables.set(name, table); }
      let row = table.rows.get(channel.element.id);
      if (row === undefined) { row = table.ids.length; table.rows.set(channel.element.id, row); table.ids.push(channel.element.id); }
      const field = table.fields.get(channel.output) ?? [];
      field.push({ column, row }); table.fields.set(channel.output, field);
    });
    this.#tables = [...tables].map(([name, table]) => ({ name, ...table }));
  }
  /** The rows of `block`, after those already installed unless `reset`. */
  pack(block: Samples, reset: boolean) {
    const times = Array.from(block.times), columns = block.columns.length;
    const patch = new Patch('simulation').axis('Time', 's');
    for (const table of this.#tables) {
      if (reset) patch.replace(table.name, table.ids, {});
      const fields: Record<string, Float32Array> = {};
      for (const [name, entries] of table.fields) {
        const values = new Float32Array(times.length * table.ids.length).fill(NaN);
        for (const { column, row } of entries)
          for (let i = 0; i < times.length; i++) values[i*table.ids.length+row] = block.values[i*columns+column]!;
        fields[name] = values;
      }
      if (times.length) patch.append(table.name, times, fields, { ids: table.ids });
    }
    return patch.toBytes();
  }
}

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

/** The network's rows, from the first to the last the run records, each page holding what fits. */
export async function* networkPages(reader: ResultReader, { channels, every, maxBytes }: NetworkFeed, signal: AbortSignal): AsyncGenerator<NetworkPage> {
  const packer = new NetworkPacker(channels), columns = channels.map(channel => channel.column);
  let from = 0;
  while (true) {
    const { rows, state, range, samples } = await reader.rows({ columns, from, every, wait: true, maxBytes }, signal);
    if (samples.times.length) {
      yield { bytes: packer.pack(samples, from === 0), rows, state, range };
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
