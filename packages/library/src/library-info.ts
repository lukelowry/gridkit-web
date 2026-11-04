import { z } from 'zod';
import { LibraryError } from './index.js';
import { shown } from './listing.js';

// Favorites use the same visible, library-relative paths as folder browsing.
const casePath = z.string().refine(path => {
  const parts = path.split('/');
  return parts.every((name, index) => shown(name, index < parts.length - 1));
});
const libraryInfo = z.object({ favorites: z.array(casePath).default([]) });

/** The optional library.json file. Repeated paths keep their first position. */
export function readFavorites(text: string): readonly string[] {
  try { return [...new Set(libraryInfo.parse(JSON.parse(text)).favorites)]; }
  catch { throw new LibraryError('protocol', 'Favorites could not be read from library.json.'); }
}
