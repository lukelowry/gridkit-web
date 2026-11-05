import { SolverError, type TimeRange } from '../index.js';

/** One file of a store, read and written by position, as OPFS's sync access handles are. */
export interface Blocks {
  read(into: Uint8Array, at: number): number;
  write(from: Uint8Array, at: number): number;
  close(): void;
}

/** One committed revision: readers take it, and the writer replaces it once every file is written. */
export interface Extent { readonly rows: number; readonly start: number; readonly end: number; readonly step: number }
/** What a revision covers, once it holds a row. */
export const timeRange = ({ rows, start, end }: Extent): TimeRange | null => rows ? [start, end] : null;

export const expired = () => new SolverError('expired', 'This simulation has expired.');
const invalid = (message: string) => new SolverError('invalid', message);
const bytes = (values: Float64Array) => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

/** `value` as Go's strconv writes it at 17 significant digits, as the solver service's CSV has it. */
function real(value: number) {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? '+Inf' : '-Inf';
  const [mantissa, exponent = ''] = value.toExponential(16).split('e');
  return `${Object.is(value, -0) ? '-' : ''}${mantissa}e${exponent[0]}${exponent.slice(1).padStart(2, '0')}`;
}

/**
 * Rows of [t, columns…] as FP64, the solver service's store in this page: each level above the rows folds every eight entries of
 * the one below into one min/max entry, and each level is a file of its own.
 */
export class Store {
  readonly columns: readonly string[];
  extent: Extent = { rows: 0, start: 0, end: 0, step: 0 };
  readonly #index: ReadonlyMap<string, number>;
  readonly #width: number;
  readonly #open: (level: number) => Promise<Blocks>;
  #files: Blocks[] = [];
  #sizes: number[] = [];
  /** Each level's summary still gathering entries, and how many it holds. */
  #partials: Float64Array[] = [];
  #held: number[] = [];
  #time = new Float64Array(1);
  #shut = false;

  constructor(columns: readonly string[], open: (level: number) => Promise<Blocks>) {
    this.columns = columns;
    this.#width = columns.length;
    this.#index = new Map(columns.map((name, index) => [name, index]));
    this.#open = open;
  }

  /** Commits whole rows: a reader sees them all, in every level, or none. Appends must not overlap. */
  async append(rows: Float64Array) {
    if (this.#shut) throw expired();
    if (!rows.length) return;
    const stride = this.#width + 1, previous = this.extent;
    let { start, end, step } = previous;
    if (!previous.rows) start = end = rows[0]!;
    for (let i = 0; i < rows.length; i += stride) {
      const t = rows[i]!;
      if (!Number.isFinite(t)) throw new SolverError('output', 'The recording has an invalid time.');
      if (t < end) throw new SolverError('output', 'The recording\'s times are not ordered.');
      step = Math.max(step, t - end); end = t;
    }
    const total = previous.rows + rows.length / stride;
    // Level n holds entries once 8^n rows are recorded. Opening a file waits; writing one does not, so every level these rows
    // reach is open before any is written.
    while (!this.#files.length || 8 ** this.#files.length <= total) {
      const file = await this.#open(this.#files.length);
      if (this.#shut) { file.close(); throw expired(); }
      this.#files.push(file); this.#sizes.push(0);
    }
    this.#write(0, rows);
    // A row is its own summary: its time starts and ends it, and each value is its minimum and maximum.
    this.#fold(1, rows, stride, 0, 1, 1);
    this.extent = { rows: total, start, end, step };
  }

  #write(level: number, values: Float64Array) {
    if (this.#files[level]!.write(bytes(values), this.#sizes[level]!) !== values.byteLength) throw new SolverError('output', 'The recording could not be kept.');
    this.#sizes[level]! += values.byteLength;
  }

  /**
   * Gathers the entries of the level below, `stride` apart in `from`, eight to each summary of `level`, and writes the summaries
   * it finishes. An entry starts at its first value, ends at `end`, and holds its minima from `low` and maxima from `high`. A
   * NaN stays in its bucket: a gap is never bridged at a coarse level.
   */
  #fold(level: number, from: Float64Array, stride: number, end: number, low: number, high: number) {
    const width = this.#width, size = 2 + 2 * width, carried = this.#held[level] ?? 0, total = carried + from.length / stride;
    // The summaries gather in place, the one carried from the last fold first.
    const out = new Float64Array(Math.ceil(total / 8) * size);
    if (carried) out.set(this.#partials[level]!);
    for (let k = carried, at = 0; at < from.length; k++, at += stride) {
      const slot = (k >> 3) * size, mins = slot + 2, maxs = slot + 2 + width, lows = at + low, highs = at + high;
      if (!(k & 7)) {
        out[slot] = from[at]!;
        out.set(from.subarray(lows, lows + width), mins);
        out.set(from.subarray(highs, highs + width), maxs);
      } else {
        for (let c = 0; c < width; c++) {
          const min = from[lows + c]!, max = from[highs + c]!;
          if (min < out[mins + c]! || min !== min) out[mins + c] = min;
          if (max > out[maxs + c]! || max !== max) out[maxs + c] = max;
        }
      }
      out[slot + 1] = from[at + end]!;
    }
    const whole = Math.floor(total / 8);
    this.#held[level] = total % 8;
    this.#partials[level] = out.slice(whole * size);
    if (!whole) return;
    const summaries = out.subarray(0, whole * size);
    this.#write(level, summaries);
    this.#fold(level + 1, summaries, size, 1, 2, 2 + width);
  }

  #read(level: number, into: Float64Array, at: number) {
    if (this.#shut) throw expired();
    if (this.#files[level]!.read(bytes(into), at) !== into.byteLength) throw new SolverError('internal', 'The recording could not be read.');
  }

  /** Each named column once, by index; an unknown or repeated name is refused by name. */
  selection(names: readonly string[]): number[] {
    const seen = new Set<string>();
    return names.map(name => {
      const column = this.#index.get(name);
      if (column === undefined) throw invalid(`This run did not record ${name}.`);
      if (seen.has(name)) throw invalid(`Choose each column once: ${name}.`);
      seen.add(name);
      return column;
    });
  }

  /** `rows` entries of one level from `first`: times then values at level 0, starts, ends, minima and maxima above it. */
  planes(level: number, first: number, rows: number, columns: readonly number[]): Float64Array<ArrayBuffer> {
    const width = this.#width, c = columns.length, stride = level ? 2 + 2 * width : width + 1;
    const out = new Float64Array((level ? 2 : 1) * rows * (1 + c));
    // Only the selected columns are kept, however wide the rows they are read from.
    const batch = Math.max(1, Math.floor((1 << 20) / (stride * 8))), buffer = new Float64Array(Math.min(batch, rows) * stride);
    for (let done = 0; done < rows;) {
      const count = Math.min(batch, rows - done), read = buffer.subarray(0, count * stride);
      this.#read(level, read, (first + done) * stride * 8);
      for (let i = 0; i < count; i++) {
        const row = i * stride, at = done + i;
        if (!level) {
          out[at] = read[row]!;
          columns.forEach((column, j) => { out[rows + at * c + j] = read[row + 1 + column]!; });
        } else {
          out[at] = read[row]!; out[rows + at] = read[row + 1]!;
          columns.forEach((column, j) => {
            out[2 * rows + at * c + j] = read[row + 2 + column]!;
            out[2 * rows + rows * c + at * c + j] = read[row + 2 + width + column]!;
          });
        }
      }
      done += count;
    }
    return out;
  }

  /** `count` rows from `first`, every `every`th: times, then values. */
  sampled(first: number, count: number, every: number, columns: readonly number[]): Float64Array<ArrayBuffer> {
    if (every === 1) return this.planes(0, first, count, columns);
    const c = columns.length, stride = this.#width + 1, out = new Float64Array(count * (1 + c)), row = new Float64Array(stride);
    for (let i = 0; i < count; i++) {
      this.#read(0, row, (first + i * every) * stride * 8);
      out[i] = row[0]!;
      columns.forEach((column, j) => { out[count + i * c + j] = row[1 + column]!; });
    }
    return out;
  }

  /** The first of `count` rows whose time passes the test, or `count`. */
  #search(count: number, passes: (t: number) => boolean) {
    let low = 0, high = count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      this.#read(0, this.#time, middle * (this.#width + 1) * 8);
      if (passes(this.#time[0]!)) high = middle; else low = middle + 1;
    }
    return low;
  }

  /** The half-open rows around a time range, with one row beyond each end. */
  interval(view: Extent, period: TimeRange | null): [number, number] {
    if (!view.rows) return [0, 0];
    if (!period) return [0, view.rows];
    if (period[1] < view.start || period[0] > view.end) return [0, 0];
    const left = this.#search(view.rows, t => t >= period[0]), right = this.#search(view.rows, t => t > period[1]);
    return [Math.max(0, left - 1), Math.min(view.rows, right + 1)];
  }

  /** The last row at or before `at`, of `count`, and how many of up to `capacity` rows follow from it. */
  around(count: number, at: number, capacity: number): [number, number] {
    if (!count) return [0, 0];
    const first = Math.max(0, Math.min(count - 1, this.#search(count, t => t > at) - 1));
    return [first, Math.min(count, first + capacity) - first];
  }

  /** The recording as GridKit writes it, in chunks: it is kept once, as numbers. */
  *csv(view: Extent): Generator<Uint8Array<ArrayBuffer>> {
    const encoder = new TextEncoder(), width = this.#width, all = this.columns.map((_, index) => index);
    yield encoder.encode(`t,${this.columns.join(',')}\n`);
    const batch = Math.max(1, Math.floor((1 << 20) / ((width + 1) * 8)));
    for (let first = 0; first < view.rows; first += batch) {
      const rows = Math.min(batch, view.rows - first), values = this.planes(0, first, rows, all);
      let text = '';
      for (let row = 0; row < rows; row++) {
        text += real(values[row]!);
        for (let j = 0; j < width; j++) text += `,${real(values[rows + row * width + j]!)}`;
        text += '\n';
      }
      yield encoder.encode(text);
    }
  }

  /** Closes the files; every read after it is refused. */
  retire() {
    this.#shut = true;
    for (const file of this.#files) file.close();
    this.#files = [];
  }
}
