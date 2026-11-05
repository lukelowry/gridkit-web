import { LibraryError, type Library } from '../index.js';
import { entries } from '../listing.js';
import { readFavorites } from '../library-info.js';
import type { ListingEntry, Options } from './index.js';

export async function library({ base }: Options, signal?: AbortSignal): Promise<Library | null> {
  base = base.replace(/\/*$/, '/');
  // Nothing answers where there is no route, nor where a static site answers with its own page.
  const root = await fetch(base, { cache: 'no-store', ...signal && { signal } });
  if (!root.ok && root.status !== 404) throw await failureOf(root);
  void root.body?.cancel();
  if (root.status === 404 || root.headers.get('content-type')?.startsWith('text/html')) return null;

  // Each read asks again; one unchanged since is answered from the browser's cache.
  const read = async (path: string, signal?: AbortSignal, allowMissing = false) => {
    const found = await fetch(base + path.split('/').map(encodeURIComponent).join('/'), { cache: 'no-cache', ...signal && { signal } });
    if (!found.ok && !(allowMissing && found.status === 404)) throw await failureOf(found);
    return found;
  };
  return {
    async favorites(signal) {
      const found = await read('library.json', signal, true);
      return found.status === 404 ? [] : readFavorites(await found.text());
    },
    async list(folder, signal) {
      const listed: unknown = await (await read(folder, signal)).json().catch(() => null);
      if (!isListing(listed)) throw new LibraryError('protocol', 'The library answered with an invalid listing.');
      return entries(folder, listed.filter(item => item.is_dir === item.name.endsWith('/')).map(item => ({
        name: item.is_dir ? item.name.slice(0, -1) : item.name, folder: item.is_dir, size: item.size,
        modified: item.mod_time ? new Date(item.mod_time) : null })));
    },
    async open(entry, signal) {
      const found = await read(entry.path, signal);
      return new File([await found.blob()], entry.path.slice(entry.path.lastIndexOf('/') + 1), { type: 'application/json' });
    },
  };
}

const isListing = (value: unknown): value is readonly ListingEntry[] => Array.isArray(value) && value.every(item =>
  typeof item?.name === 'string' && Number.isInteger(item.size) && item.size >= 0 && typeof item.is_dir === 'boolean'
  && (item.mod_time === undefined || typeof item.mod_time === 'string'));

/** The failure a service answered with, as `{ code, message }`, else one naming its status. */
async function failureOf(response: Response) {
  const said = await response.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
  return new LibraryError(typeof said?.code === 'string' ? said.code : 'unavailable',
    typeof said?.message === 'string' ? said.message : `The library answered ${response.status}.`);
}
