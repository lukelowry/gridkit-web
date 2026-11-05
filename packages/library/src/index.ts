/**
 * @gridkit/library: GridKit's cases, and where they are kept. A case is GridKit's network of buses, devices and signals, inspected
 * as an immutable document of elements; a library lists folders of cases and opens one as a file. Each folder beside this file adds a way:
 *   ./http     a library service: the library image's Caddy over a folder, or the R2 Worker over a bucket
 *   ./file     a folder of files, as a directory handle gives them: one the user picks, or the browser's own
 *   ./gridkit  a case as GridKit's DynamicSimulation runs it: its study, its native model, and what it records
 */

// The case: GridKit's format, read and written exactly, its values deeply frozen.
export { collections, createCase, detailsOf, freezeJson, parseCase, serializeCase, serializeCaseRow } from './case.js';
export type { Bus, Case, Collection, Details, Device, ElementRef, JsonObject, Signal } from './case.js';

// GridKit's models: each one's parameters, initial values, connections and outputs.
export { elementCatalog, models, parameterIssues } from './catalog.js';
export type { ElementDefinition, Model, PortDefinition } from './catalog.js';
export { required } from './manifest.js';
export type { Requirement } from './manifest.js';

// The immutable case document: indexed elements, stable identities, native connections and saved views.
export { CaseDocument, readSavedViews } from './document.js';
export type {
  ConnectedDevice, Connection, ElementRecord, Position, SavedViews, Space,
} from './document.js';
export { portsOf } from './connections.js';

// Each element's fields, by path, and what kinds of values they hold across the case.
export { busName, elementFields, equal, fieldGroup, record, targetKey, targetOf } from './fields.js';
export type { ElementTarget, FieldInfo, FieldKind } from './fields.js';

// What GridKit needs of a case before it can run it.
export { baseIssues, caseReadiness, elementIssues } from './readiness.js';
export type { CaseIssue, ReadinessIssue } from './readiness.js';

/** A case in a library, or a folder of them. */
export interface LibraryEntry {
  /** Where it is beneath the library's root; a folder's ends in a slash. */
  readonly path: string;
  /** Its name to show: a case's without `.case.json`. */
  readonly title: string;
  readonly folder: boolean;
  /** A case's size in bytes; a folder's is 0. */
  readonly size: number;
  readonly modified: Date | null;
}

export interface Library {
  /** A folder's folders, then its cases, each in natural order. The root is ''. */
  list(folder: string, signal?: AbortSignal): Promise<readonly LibraryEntry[]>;
  /** Shared favorite case paths; empty where none are published. */
  favorites(signal?: AbortSignal): Promise<readonly string[]>;
  /** A case, as a file. */
  open(entry: Pick<LibraryEntry, 'path'>, signal?: AbortSignal): Promise<File>;
}

/** What went wrong, as a library says it: missing, read-only, authentication, unavailable, protocol, or a service's own. */
export class LibraryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'LibraryError'; }
}
