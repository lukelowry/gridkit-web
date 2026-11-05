import { expect, it } from 'vitest';
import worker, { type Bucket } from './worker.ts';

const uploaded = new Date('2026-11-01T00:00:00Z');
/** An R2 bucket holding `files`, answering as R2 does: a page at a time, and no body where a precondition fails. */
function bucket(files: Record<string, string>, size = 2): Bucket {
  const etag = (key: string) => `"${key}"`;
  return {
    async list({ prefix, delimiter, cursor }) {
      const keys = Object.keys(files).filter(key => key.startsWith(prefix)).sort();
      const items = [...new Set(keys.map(key => {
        const rest = key.slice(prefix.length), end = rest.indexOf(delimiter);
        return end < 0 ? key : prefix + rest.slice(0, end + 1);
      }))];
      const start = Number(cursor ?? 0), page = items.slice(start, start + size), more = start + size < items.length;
      return { objects: page.filter(item => item in files).map(key => ({ key, size: files[key]!.length, uploaded })),
        delimitedPrefixes: page.filter(item => !(item in files)), truncated: more, ...more && { cursor: String(start + size) } };
    },
    async get(key, { onlyIf }) {
      if (!(key in files)) return null;
      const file = { httpEtag: etag(key), size: files[key]!.length };
      return onlyIf.get('if-none-match') === file.httpEtag ? file : { ...file, body: new Response(files[key]).body! };
    },
  };
}
const library = { LIBRARY: bucket({ 'IEEE39.case.json': '{"a":1}', 'WECC240.case.json': '{}', 'IEEE/IEEE14.case.json': '{}', '.hidden': 'x' }) };
const ask = (path: string, init?: RequestInit, env: Parameters<typeof worker.fetch>[1] = library) =>
  worker.fetch(new Request(`https://library.test${path}`, init), env);

it("lists each folder as the library image's file server lists one, across pages", async () => {
  expect(await (await ask('/')).json()).toEqual([
    { name: 'IEEE/', size: 0, is_dir: true },
    { name: 'IEEE39.case.json', size: 7, mod_time: uploaded.toISOString(), is_dir: false },
    { name: 'WECC240.case.json', size: 2, mod_time: uploaded.toISOString(), is_dir: false },
  ]);
  expect(await (await ask('/IEEE/')).json()).toEqual([{ name: 'IEEE14.case.json', size: 2, mod_time: uploaded.toISOString(), is_dir: false }]);
  expect((await ask('/missing/')).status).toBe(404);
});

it('serves a file with its validator, and not again while it is unchanged', async () => {
  const file = await ask('/IEEE39.case.json');
  expect(file.headers.get('content-type')).toBe('application/json');
  expect(file.headers.get('cache-control')).toBe('no-cache');
  expect(await file.text()).toBe('{"a":1}');
  const unchanged = await ask('/IEEE39.case.json', { headers: { 'If-None-Match': file.headers.get('etag')! } });
  expect(unchanged.status).toBe(304);
  expect(unchanged.body).toBeNull();
  expect((await ask('/IEEE39.case.json', { method: 'HEAD' })).body).toBeNull();
  const missing = await ask('/missing.case.json');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ code: 'missing', message: 'The library has no such file.' });
});

it('serves shared favorites through the same conditional file route', async () => {
  const info = { favorites: ['IEEE39.case.json', 'IEEE/IEEE14.case.json'] };
  const env = { LIBRARY: bucket({ 'library.json': JSON.stringify(info) }) };
  const response = await ask('/library.json', {}, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(info);
  expect(response.headers.get('content-type')).toBe('application/json');
  const unchanged = await ask('/library.json', { headers: { 'If-None-Match': response.headers.get('etag')! } }, env);
  expect(unchanged.status).toBe(304);
});

it('is read-only, and readable from any page', async () => {
  const write = await ask('/IEEE39.case.json', { method: 'PUT', body: '{}' });
  expect(write.status).toBe(405);
  expect(write.headers.get('allow')).toBe('GET, HEAD');
  for (const answer of [write, await ask('/'), await ask('/IEEE39.case.json'), await ask('/missing.case.json')]) {
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
  }
});
