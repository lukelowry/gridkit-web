import type { Library } from '../index.js';
import { library } from './library.js';

/** A folder of files, as a directory handle gives them: one the user picks (showDirectoryPicker), or the browser's own. */
export interface Options { readonly directory: FileSystemDirectoryHandle }

/** The folder as a library, or null where it may not be read and asking does not allow it; asking needs the user's click. */
export const connect: (options: Options, signal?: AbortSignal) => Promise<Library | null> = library;
