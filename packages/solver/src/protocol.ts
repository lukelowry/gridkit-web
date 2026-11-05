import type { ArtifactName, Cursor, Failure, Revision, RowsQuery, RunId, RunState, SummaryQuery, TileDescription, TimeRange } from './index.js';

// The one protocol every implementation speaks: the page commands its solver's worker, which says what each run does; a reader
// asks through a port of its own, and hears a header, then the numbers or bytes it asked for, moved rather than copied.

/** What a solver says of a run each time it changes. */
export interface RunStatus {
  readonly sequence: number;
  readonly state: RunState;
  readonly rows: number;
  readonly range: TimeRange | null;
  readonly error?: Failure;
}

/** The page to its solver's worker; each command is answered once, by its id. */
export type Command =
  | { readonly id: number; readonly op: 'open'; readonly options: unknown }
  | { readonly id: number; readonly op: 'start'; readonly run: RunId; readonly study: object; readonly model: Blob }
  | { readonly id: number; readonly op: 'cancel'; readonly run: RunId }
  | { readonly id: number; readonly op: 'results'; readonly run: RunId; readonly port: MessagePort };
/** The worker to the page: each command's answer, and each run's statuses as they change, or why it can no longer say. */
export type Event =
  | { readonly kind: 'answer'; readonly id: number; readonly error?: Failure; readonly absent?: true }
  | { readonly kind: 'status'; readonly run: RunId; readonly status: RunStatus }
  | { readonly kind: 'lost'; readonly run: RunId; readonly error: Failure };

/** A reader to its run, through its port: a question, the next part of an answer, or no more of one. */
export type Ask =
  | { readonly id: number; readonly op: 'rows'; readonly query: RowsQuery }
  | { readonly id: number; readonly op: 'summary'; readonly query: SummaryQuery }
  | { readonly id: number; readonly op: 'artifact'; readonly name: ArtifactName }
  | { readonly id: number; readonly op: 'next' }
  | { readonly id: number; readonly op: 'abort' }
  | { readonly op: 'close' };
/**
 * The run to its reader: an answer's header, with its parts where they are at hand, else `more` and a part each time the reader
 * asks for the next, until the end.
 */
export type Answer =
  | { readonly id: number; readonly header: unknown; readonly parts: readonly ArrayBuffer[]; readonly more: boolean }
  | { readonly id: number; readonly part: ArrayBuffer }
  | { readonly id: number; readonly end: true }
  | { readonly id: number; readonly error: Failure };

/** An answer as an implementation gives it: its header, and its parts, at hand or made as they are asked for. */
export interface Reply<H> { readonly header: H; readonly parts: readonly ArrayBuffer[] | AsyncIterable<ArrayBuffer> }

/** `count` rows from `first`: one part, their times then their time-major values. */
export interface RowsHeader extends Revision { readonly first: number; readonly count: number }
/** A summary's plan: one part per tile, in turn. */
export interface SummaryHeader extends Revision {
  readonly reset: boolean;
  readonly cursor: Cursor;
  readonly tiles: readonly TileDescription[];
}
/** A file: a link the browser downloads itself, or its bytes as parts. */
export interface ArtifactHeader { readonly href?: string }
