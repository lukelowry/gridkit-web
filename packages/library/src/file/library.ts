import { LibraryError, type Library } from '../index.js';
import { entries, shown, type Item } from '../listing.js';
import { readFavorites } from '../library-info.js';
import type { Options } from './index.js';

/** Chromium's permission methods, which lib.dom does not declare; a folder without them (the browser's own) is always readable. */
interface Permitted {
  queryPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
}
const read = { mode: 'read' } as const;

export async function library({ directory }: Options, signal?: AbortSignal): Promise<Library | null> {
  if ('queryPermission' in directory) {
    const folder = directory as FileSystemDirectoryHandle & Permitted;
    if (await folder.queryPermission(read) !== 'granted' && await folder.requestPermission(read) !== 'granted') return null;
  }
  signal?.throwIfAborted();
  /** The folder at `path`, a name at a time; every name came from a listing, so none climbs out. */
  const within = async (path: string) => {
    let folder = directory;
    for (const name of path.split('/').filter(Boolean)) folder = await folder.getDirectoryHandle(name);
    return folder;
  };
  return {
    favorites: (signal) => reading('file', async () => {
      signal?.throwIfAborted();
      let handle: FileSystemFileHandle;
      try { handle = await directory.getFileHandle('library.json'); }
      catch (cause) {
        signal?.throwIfAborted();
        if (cause instanceof DOMException && cause.name === 'NotFoundError') return [];
        throw cause;
      }
      const text = await (await handle.getFile()).text();
      signal?.throwIfAborted();
      return readFavorites(text);
    }),
    list: (folder, signal) => reading('folder', async () => {
      const items: Item[] = [];
      for await (const handle of (await within(folder)).values()) {
        signal?.throwIfAborted();
        if (!shown(handle.name, handle.kind === 'directory')) continue;
        if (handle.kind === 'directory') { items.push({ name: handle.name, folder: true, size: 0, modified: null }); continue; }
        const file = await (handle as FileSystemFileHandle).getFile();
        items.push({ name: handle.name, folder: false, size: file.size, modified: new Date(file.lastModified) });
      }
      return entries(folder, items);
    }),
    open: (entry, signal) => reading('file', async () => {
      const at = entry.path.lastIndexOf('/');
      const handle = await (await within(entry.path.slice(0, at + 1))).getFileHandle(entry.path.slice(at + 1));
      signal?.throwIfAborted();
      // The file itself, read only as the UI reads it: nothing is copied.
      return handle.getFile();
    }),
  };
}

/** What the browser says went wrong, as a library says it. */
async function reading<T>(what: 'folder' | 'file', work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (cause) {
    const name = cause instanceof DOMException ? cause.name : '';
    if (name === 'NotFoundError' || name === 'TypeMismatchError') throw new LibraryError('missing', `The library has no such ${what}.`);
    if (name === 'NotAllowedError') throw new LibraryError('unavailable', 'The library may no longer be read here.');
    throw cause;
  }
}
