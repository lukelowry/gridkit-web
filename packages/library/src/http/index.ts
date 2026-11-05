import type { Library } from '../index.js';
import { library } from './library.js';

/** GET <base><folder>/ lists a folder; GET <base><path> reads a file, including optional library.json. Failures are `{ code, message }`. */
export interface Options { readonly base: string }

/**
 * One item of a folder as a library service lists it: Caddy's file_server browse format, which the R2 Worker writes too.
 * A folder's name ends in a slash.
 */
export interface ListingEntry { readonly name: string; readonly size: number; readonly mod_time?: string; readonly is_dir: boolean }

/** The library service at `options.base`, or null where nothing answers there. */
export const connect: (options: Options, signal?: AbortSignal) => Promise<Library | null> = library;
