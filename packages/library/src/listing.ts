import type { LibraryEntry } from './index.js';

/** One item of a folder, however a library reads it: its bare name, a folder's without its slash. */
export interface Item { readonly name: string; readonly folder: boolean; readonly size: number; readonly modified: Date | null }

const caseFile = /\.case\.json$/;
/** A visible name within one folder: never hidden, never . or .., never a path. */
const visible = /^[^./\\\0][^/\\\0]*$/;
const order = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Whether a library shows an item, asked before reading anything more of it: a folder, or a case. */
export const shown = (name: string, folder: boolean) => visible.test(name) && (folder || caseFile.test(name));

/** The entries of `folder`: what it shows of `items`, folders first, then cases, each in natural order. */
export function entries(folder: string, items: Iterable<Item>): LibraryEntry[] {
  return [...items].filter(item => shown(item.name, item.folder))
    .map(item => ({ path: folder + item.name + (item.folder ? '/' : ''), title: item.name.replace(caseFile, ''),
      folder: item.folder, size: item.size, modified: item.modified }))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || order.compare(a.title, b.title));
}
