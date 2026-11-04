import { expect, it, vi } from 'vitest';
import worker, { type Env } from './worker.ts';

const library = (token?: string) => {
  const fetch = vi.fn(async (_url: URL, _init: RequestInit) => Response.json([]));
  return { env: { LIBRARY: { fetch }, ...token && { GRIDKIT_LIBRARY_TOKEN: token } } satisfies Env, fetch };
};

it('answers api/library/ from the library, which sees the rest as its root, with its token and without the browser\'s cookies', async () => {
  const { env, fetch } = library('secret');
  await worker.fetch(new Request('https://editor.test/api/library/IEEE/IEEE%2039.case.json?x=1',
    { headers: { Accept: 'application/json', 'If-None-Match': '"case"', Cookie: 'session', Authorization: 'page' } }), env);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url.href).toBe('https://editor.test/IEEE/IEEE%2039.case.json?x=1');
  const sent = init.headers as Headers;
  expect([...sent]).toEqual([['accept', 'application/json'], ['authorization', 'Bearer secret'], ['if-none-match', '"case"']]);
});

it('sends no token it has none of, and has no other service', async () => {
  const { env, fetch } = library();
  await worker.fetch(new Request('https://editor.test/api/library/'), env);
  expect((fetch.mock.calls[0]![1].headers as Headers).has('authorization')).toBe(false);
  for (const path of ['api', 'api/', 'api/solver/', 'api/libraryx/']) {
    const response = await worker.fetch(new Request(`https://editor.test/${path}`), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'missing' });
  }
  expect(fetch).toHaveBeenCalledOnce();
});
