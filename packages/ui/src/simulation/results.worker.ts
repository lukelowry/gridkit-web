import { Patch } from 'latkit';
import { isTerminal, openReader, type Envelope, type ResultReader, type RunState, type Samples, type TimeRange } from '@gridkit/solver';
import { affine, type Affine, type Basis } from '../domain/measure.js';
import type { ResultsCommand, ResultsMessage, ResultsReply } from './results.js';
import type { NetworkPlan } from './recording-plan.js';
import { plotDataset } from './plot.js';

/** How often a feed that has caught up asks for more. */
const interval = 1000 / 30;

/** What the network draws, from the start, with reads and transfers bounded independently of its width. */
export interface NetworkFeed {
  readonly plan: NetworkPlan;
  /** Every Nth row, where the whole run would not fit. */
  readonly every: number;
  readonly maxBytes: number;
}
/** What a plot's time tiles hold: `columns`, measured as `basis` from `reference`. */
export interface TileSet {
  readonly columns: readonly string[];
  readonly basis: Basis;
  readonly reference: number | null;
}
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
/** `block`, entries of `level` from `first`, as latkit's frames of the plot's traces. */
function addTile(patch: Patch, level: number, first: number, block: Samples | Envelope, shift?: (column: string) => Affine) {
  const shifts = shift && block.columns.map(shift);
  if (block.kind === 'samples') {
    patch.frames('Trace', 'value', { level, first, at: block.times, values: valuesOf([block.values], shifts) });
  } else {
    const at = new Float64Array(block.starts.length * 2);
    for (let i = 0; i < block.starts.length; i++) { at[2*i] = block.starts[i]!; at[2*i+1] = block.ends[i]!; }
    patch.frames('Trace', 'value', { level, first, at, values: valuesOf([block.minimum, block.maximum], shifts) });
  }
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, interval);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Each column's last value at or before `reference`, or its first without one. */
async function referencesOf(reader: ResultReader, columns: readonly string[], reference: number | null): Promise<References> {
  const { samples } = await reader.rows({ columns, at: reference ?? -Number.MAX_VALUE, count: 1, maxBytes: 8 * (1 + columns.length) });
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

/** Entries a span of time tiles holds: a multiple of 8, near 1 MiB of Float32 least and greatest values. */
const chunkOf = (columns: number) => Math.max(8, Math.floor((1 << 17) / columns / 8) * 8);

/**
 * File `path` of `set`'s time tiles, as latkit fetches it: the manifest, the base dataset, or a span of one level. `shift` gives
 * each column's measure, taken in Float64 before the values become Float32.
 */
export async function tileFile(reader: ResultReader, { columns }: TileSet, path: string,
  shift: () => Promise<((column: string) => Affine) | undefined>): Promise<Uint8Array> {
  const chunk = chunkOf(columns.length);
  if (path === 'frames.json') {
    const { rows } = await reader.rows({ columns: columns.slice(0, 1), count: 1, maxBytes: 16 });
    let levels = 0;
    while (8 ** (levels + 1) <= rows) levels++;
    return new TextEncoder().encode(JSON.stringify({ data: 'base.latk', chunk, url: '{level}/{index}.latk',
      frames: [{ table: 'Trace', field: 'value', levels, frames: [0, rows] }] }));
  }
  if (path === 'base.latk')
    return new Patch(plotDataset).axis('Time', 's').replace('Trace', columns, { series: Float32Array.from(columns, (_, i) => i) }).toBytes();
  const [level, index] = path.slice(0, -'.latk'.length).split('/').map(Number) as [number, number];
  const first = index * chunk, planes = level ? 2 : 1;
  const { block } = await reader.entries({ columns, level, first, count: chunk, maxBytes: 8 * planes * chunk * (1 + columns.length) });
  const patch = new Patch(plotDataset);
  addTile(patch, level, first, block, await shift());
  return patch.toBytes();
}

/**
 * What a run's results worker serves: one reader of the run, each feed of it a page at a time, as each is asked, and the plot's
 * time tiles a file at a time.
 */
export class ResultHost {
  #reader: ResultReader | undefined;
  #feeds = new Map<number, { pages: AsyncGenerator<NetworkPage>; abort: AbortController }>();
  /** Each tile set's measure, read once. */
  #shifts = new Map<string, Promise<((column: string) => Affine) | undefined>>();
  constructor(private open: (port: MessagePort) => ResultReader) {}
  async handle(command: ResultsCommand): Promise<NetworkPage | Uint8Array | null> {
    switch (command.kind) {
      case 'open':
        this.close();
        this.#reader = this.open(command.port);
        return null;
      case 'follow': {
        this.#stop(command.feed);
        if (!this.#reader) throw new Error('No results to read.');
        const abort = new AbortController();
        this.#feeds.set(command.feed, { abort, pages: networkPages(this.#reader, command.request, abort.signal) });
        return null;
      }
      case 'tile': {
        const reader = this.#reader;
        if (!reader) throw new Error('No results to read.');
        return tileFile(reader, command.set, command.path, () => this.#shift(reader, command.set));
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
  /** How `set` measures each column; one that could not be read is read again by the next span. */
  #shift(reader: ResultReader, { columns, basis, reference }: TileSet) {
    if (basis === 'value') return Promise.resolve(undefined);
    const key = JSON.stringify([columns, basis, reference]);
    let shift = this.#shifts.get(key);
    if (!shift) {
      shift = referencesOf(reader, columns, reference).then(references => (column: string) => affine(basis, references.get(column) ?? NaN));
      shift.catch(() => this.#shifts.delete(key));
      this.#shifts.set(key, shift);
    }
    return shift;
  }
  /** Stops every feed, and lets the run's port go. */
  close() {
    for (const id of [...this.#feeds.keys()]) this.#stop(id);
    this.#shifts.clear();
    this.#reader?.close();
    this.#reader = undefined;
  }
}
/** The buffers a reply gives up, moved to the main thread rather than copied. */
export const transferOf = (value: NetworkPage | Uint8Array | null) =>
  (!value ? [] : value instanceof Uint8Array ? [value.buffer] : [value.bytes.buffer]).filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);

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
