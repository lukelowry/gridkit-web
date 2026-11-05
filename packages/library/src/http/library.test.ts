import { afterEach, expect, it, vi } from 'vitest';
import { LibraryError } from '../index.js';
import { connect } from './index.js';

afterEach(() => vi.unstubAllGlobals());

/** A library service at /api/library/, answering by what is asked of it. */
function service(answer: (path: string) => Response | unknown) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const value = answer(new URL(url, 'http://local').pathname);
    return value instanceof Response ? value : Response.json(value);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

it.each([
  ['no route', () => new Response(null, { status: 404 })],
  ['a static site answering with its page', () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })],
])('finds no library behind %s', async (_where, answer) => {
  const fetch = service(answer);
  expect(await connect({ base: 'https://ui.test/workspace/api/library/' })).toBeNull();
  expect(fetch).toHaveBeenCalledWith('https://ui.test/workspace/api/library/', expect.objectContaining({ cache: 'no-store' }));
});

it('says why a library it was pointed at does not answer, in its own words', async () => {
  service(() => Response.json({ code: 'unavailable', message: 'Cannot reach the library service at http://127.0.0.1:8082.' }, { status: 502 }));
  await expect(connect({ base: '/api/library/' })).rejects.toMatchObject({ code: 'unavailable', message: 'Cannot reach the library service at http://127.0.0.1:8082.' });
  service(() => new Response('', { status: 500 }));
  await expect(connect({ base: '/api/library/' })).rejects.toEqual(new LibraryError('unavailable', 'The library answered 500.'));
});

it('lists folders, then cases, in natural order, leaving out what the UI cannot open or what would leave the folder', async () => {
  service(() => [
    { name: 'IEEE118.case.json', size: 3, mod_time: '2026-11-01T00:00:00Z', is_dir: false },
    { name: 'IEEE14.case.json', size: 1, mod_time: '2026-11-01T00:00:00Z', is_dir: false },
    { name: 'WECC/', size: 0, is_dir: true },
    { name: 'notes.txt', size: 2, is_dir: false },
    { name: '../', size: 0, is_dir: true },
    { name: 'IEEE/../x.case.json', size: 0, is_dir: false },
    // A folder must be listed as one.
    { name: 'Odd/', size: 0, is_dir: false },
  ]);
  const entries = await (await connect({ base: '/api/library' }))!.list('');
  expect(entries.map(entry => [entry.path, entry.title, entry.folder])).toEqual([
    ['WECC/', 'WECC', true], ['IEEE14.case.json', 'IEEE14', false], ['IEEE118.case.json', 'IEEE118', false]]);
  expect(entries[1]!.modified).toEqual(new Date('2026-11-01T00:00:00Z'));
});

it('refuses a listing it cannot read', async () => {
  service(path => path === '/api/library/' ? [] : [{ name: 'IEEE14.case.json', size: -1, is_dir: false }]);
  await expect((await connect({ base: '/api/library/' }))!.list('IEEE/')).rejects.toMatchObject({ code: 'protocol' });
});

it('opens a case beneath a folder as a file, and reports what the library says when it cannot', async () => {
  const fetch = service(path => path === '/api/library/' ? [] : path.endsWith('missing.case.json')
    ? Response.json({ code: 'missing', message: 'The library has no such file.' }, { status: 404 }) : { header: {} });
  const library = (await connect({ base: '/api/library/' }))!;
  const file = await library.open({ path: 'IEEE/IEEE 14.case.json' });
  expect(file.name).toBe('IEEE 14.case.json');
  expect(await file.text()).toBe('{"header":{}}');
  expect(fetch.mock.calls.at(-1)![0]).toBe('/api/library/IEEE/IEEE%2014.case.json');
  expect(fetch.mock.calls.at(-1)![1]).toMatchObject({ cache: 'no-cache' });
  await expect(library.open({ path: 'missing.case.json' }))
    .rejects.toEqual(new LibraryError('missing', 'The library has no such file.'));
});

it('reads shared favorites without listing their folders or downloading cases, using HTTP revalidation', async () => {
  const fetch = service(path => path === '/api/library/' ? [] : { favorites: ['IEEE/IEEE 39.case.json', 'TwoArea.case.json'] });
  const library = (await connect({ base: '/api/library/' }))!;
  const signal = new AbortController().signal;
  expect(await library.favorites(signal)).toEqual(['IEEE/IEEE 39.case.json', 'TwoArea.case.json']);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/library/', '/api/library/library.json']);
  expect(fetch.mock.calls.at(-1)![1]).toMatchObject({ cache: 'no-cache', signal });
});

it('treats only a missing favorites file as empty and leaves folder browsing available after invalid metadata', async () => {
  let metadata: Response = new Response(null, { status: 404 });
  service(path => path === '/api/library/library.json' ? metadata : []);
  const library = (await connect({ base: '/api/library/' }))!;
  expect(await library.favorites()).toEqual([]);
  metadata = Response.json({ favorites: ['../escape.case.json'] });
  await expect(library.favorites()).rejects.toMatchObject({ code: 'protocol' });
  expect(await library.list('')).toEqual([]);
  metadata = Response.json({ code: 'authentication', message: 'Library authentication required.' }, { status: 401 });
  await expect(library.favorites()).rejects.toMatchObject({ code: 'authentication' });
});
