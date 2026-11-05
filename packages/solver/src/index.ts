/**
 * @gridkit/solver: what a solver offers, wherever GridKit runs. A solver starts studies, and each run says how it goes, stops when
 * asked, offers its files, and is read through a port of its own. Each implementation is a folder beside this file, and
 * test/conformance.ts holds each to this contract:
 *   ./http  a solver service, followed and read in a worker of its own
 *   ./wasm  GridKit in the page, its runs kept in the origin's private files
 */
import { reader } from './reader.js';

export type TimeRange = readonly [number, number];
/** A run's name, which the page gives it. */
export type RunId = string;

/** A study for GridKit: its settings and its native model, compiled by whoever asks. The solver chooses where its files go. */
export interface RunRequest { readonly study: object; readonly model: Blob }

export interface Solver {
  /** Starts a study and answers at once; the upload, or the start, happens behind it. */
  start(request: RunRequest): Run;
  /** Stops the solver, ending every run it follows and what it holds. */
  close(): void;
}

export interface Run {
  /**
   * The current update first, then each newer one, coalesced, until the run ends; a failure to follow the run ends them with it.
   * Ending the loop stops only watching.
   */
  updates(signal?: AbortSignal): AsyncIterable<RunUpdate>;
  /** Resolves once the solver confirms the run stopped, or the upload is abandoned. */
  cancel(): Promise<void>;
  /** A port of its own to the run's results, for a reader in any thread (see openReader). */
  results(): Promise<MessagePort>;
  /** What the run offers to download, once it has ended. */
  readonly artifacts: Promise<readonly Artifact[]>;
}

/** What a solver says of a run. */
export const runStates = ['running', 'completed', 'cancelled', 'failed'] as const;
export type RunState = typeof runStates[number];
export const isTerminal = (state: string) => state === 'completed' || state === 'cancelled' || state === 'failed';

/** What went wrong, as a solver says it: a code to act on, and a message to show. */
export interface Failure { readonly code: string; readonly message: string }
/**
 * A solver's failure, wherever it runs. Its codes: invalid, busy, expired, unavailable, simulation, output, protocol, and internal;
 * a service may say others.
 */
export class SolverError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'SolverError'; }
  /** `cause` as a solver says it. */
  static of(cause: unknown): Failure {
    const { code, message } = (cause ?? {}) as { code?: unknown; message?: unknown };
    return { code: typeof code === 'string' ? code : 'internal', message: typeof message === 'string' ? message : String(cause) };
  }
}

/** What a run has recorded so far, and the times it covers. */
export interface Progress { readonly rows: number; readonly range: TimeRange }
export type RunUpdate =
  | { readonly state: 'preparing' | 'running' | 'cancelled'; readonly progress: Progress | null }
  | { readonly state: 'completed'; readonly progress: Progress }
  | { readonly state: 'failed'; readonly progress: Progress | null; readonly error: Failure };

/** What every run offers to download, and the file each is. */
export const artifactFiles = { results: 'results.csv', log: 'run.log', solver: 'solver.json' } as const;
export type ArtifactName = keyof typeof artifactFiles;
/** A file a run offers: a link the browser downloads itself, or one made as it is written into `output`, which it closes. */
export type Artifact = { readonly name: ArtifactName; readonly file: typeof artifactFiles[ArtifactName] }
  & ({ readonly href: string } | { write(output: WritableStream<Uint8Array>): Promise<void> });

/** A run's results, read through its port. */
export interface ResultReader {
  rows(query: RowsQuery, signal?: AbortSignal): Promise<RowsReply>;
  summary(query: SummaryQuery, signal?: AbortSignal): Promise<SummaryReply>;
  /** Ends the reader and its port. */
  close(): void;
}

export interface RowsQuery {
  readonly columns: readonly string[];
  /** The first row, or `at`: the last at or before a time. */
  readonly from?: number;
  readonly at?: number;
  /** Every Nth row from there. */
  readonly every?: number;
  readonly count?: number;
  /** Hold until the recording passes `from`, or the run ends. */
  readonly wait?: boolean;
  /** The largest numeric payload of the reply. */
  readonly maxBytes: number;
}
export interface Samples {
  readonly kind: 'samples';
  /** Absolute recorded row index, including distinct rows at duplicate times. */
  readonly first: number;
  readonly columns: readonly string[];
  readonly times: Float64Array;
  /** Time-major: values[row * columns.length + column]. NaN represents a gap. */
  readonly values: Float64Array;
}
export interface Envelope {
  readonly kind: 'envelope';
  readonly columns: readonly string[];
  readonly starts: Float64Array;
  readonly ends: Float64Array;
  /** Bucket-major within each plane. Paired NaN values mark a bucket containing a gap; finer reads recover its finite
   * neighbours without inventing bridges. */
  readonly minimum: Float64Array;
  readonly maximum: Float64Array;
}
/** What a reply says of the recording when it answered. */
export interface Revision {
  /** The rows committed so far. */
  readonly rows: number;
  readonly state: RunState;
  readonly range: TimeRange | null;
}
export interface RowsReply extends Revision { readonly samples: Samples }

/** The history a reader holds: `sealed` rows, from `first`, at one level of detail. */
export interface Cursor { readonly level: number; readonly first: number; readonly sealed: number }
export interface SummaryQuery {
  readonly columns: readonly string[];
  /** The times to cover, or all of them. */
  readonly range: TimeRange | null;
  /** Horizontal resolution in physical pixels: coarse buckets span at most one. Independent of maxBytes, which bounds each tile. */
  readonly resolution: number;
  readonly maxBytes: number;
  readonly cursor?: Cursor | null;
  /** Hold until the recording has more than this many rows, or the run ends. */
  readonly after?: number;
}
/** A run of native entries. Above level 0 an entry spans 8^level rows. */
export interface TileDescription {
  /** History extends what a reader holds; an edge replaces what it held around that. */
  readonly target: 'history' | 'edge';
  readonly kind: 'samples' | 'envelope';
  readonly level: number;
  readonly first: number;
  readonly rows: number;
}
export interface Tile {
  readonly target: TileDescription['target'];
  readonly level: number;
  readonly first: number;
  readonly block: Samples | Envelope;
}
/** One whole update of a summary: its plan at once, then its tiles as they arrive. */
export interface SummaryReply extends Revision {
  readonly reset: boolean;
  readonly cursor: Cursor;
  readonly tiles: readonly TileDescription[];
  pages(): AsyncGenerator<Tile>;
}

/** A reader of the run whose port `port` is (Run.results), in any thread, whatever solver serves it. */
export const openReader: (port: MessagePort) => ResultReader = reader;
