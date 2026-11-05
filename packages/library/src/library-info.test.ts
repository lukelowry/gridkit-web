import { expect, it } from 'vitest';
import { readFavorites } from './library-info.js';

it('reads shared favorite paths and removes duplicates', () => {
  expect(readFavorites(JSON.stringify({ favorites: ['IEEE/IEEE 39.case.json', 'TwoArea.case.json', 'IEEE/IEEE 39.case.json'] })))
    .toEqual(['IEEE/IEEE 39.case.json', 'TwoArea.case.json']);
  expect(readFavorites('{}')).toEqual([]);
});

it.each(['{', 'null', '[]', '{"favorites":"IEEE39.case.json"}', '{"favorites":[42]}'])('rejects invalid metadata: %s', text => {
  expect(() => readFavorites(text)).toThrow('Favorites could not be read from library.json.');
});

it.each(['', '/case.case.json', '../case.case.json', 'IEEE/../case.case.json', 'IEEE/./case.case.json',
  'IEEE//case.case.json', 'IEEE\\case.case.json', 'case\0.case.json', '.hidden.case.json', '.hidden/case.case.json',
  'case.json', 'folder/', 'https://example.test/case.case.json'])('rejects a path outside normal case browsing: %s', path => {
  expect(() => readFavorites(JSON.stringify({ favorites: [path] }))).toThrow();
});
