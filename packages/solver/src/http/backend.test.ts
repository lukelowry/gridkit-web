import { afterEach, expect, it, vi } from 'vitest';
import { openReader, type Solver } from '../index.js';
import { connect } from './index.js';

const request = { study: { tmax: 1, dt_monitor: .1 }, model: new Blob(['{"buses":[]}']) };
const completed = { sequence: 2, state: 'completed', rows: 10, range: [0, 1] };
/** A service's reply: its length-prefixed header, then its planes. */
function frame(header: unknown, values = new Float64Array()) {
  const json = new TextEncoder().encode(JSON.stringify(header)), bytes = new Uint8Array(4 + json.length + values.byteLength);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, 4); bytes.set(new Uint8Array(values.buffer), 4 + json.length);
  return bytes;
}
/** A solver mounted at /api/solver/, answering by what is asked of it. */
function solver(answer: (path: string, init?: RequestInit) => unknown) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url, 'http://local');
    const value = pathname === '/api/solver/' ? new Response(null, { status: 204 }) : await answer(pathname, init);
    return value instanceof Response ? value : Response.json(value);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const opened: Solver[] = [];
async function connected(base = '/api/solver/') {
  const solver = await connect({ base });
  if (solver) opened.push(solver);
  return solver;
}

afterEach(() => {
  for (const solver of opened.splice(0)) solver.close();
  vi.unstubAllGlobals();
});

it('finds no solver where the host mounts none, nor where a static host answers with its page', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  expect(await connected('https://ui.test/workspace/api/solver/')).toBeNull();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })));
  expect(await connected()).toBeNull();
});

it('reports a solver that fails instead of editing without one', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'unavailable', message: 'Starting.' }, { status: 503 })));
  await expect(connected()).rejects.toMatchObject({ code: 'unavailable', message: 'Starting.' });
});

it('finds a solver by its answer at its root', async () => {
  const fetch = solver(() => { throw new Error('Nothing else is asked.'); });
  expect(await connected('/api/solver')).not.toBeNull();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/solver/']);
});

it('rejects malformed state and reports a solver that cannot confirm cancellation', async () => {
  solver(path => path === '/api/solver/runs' ? { id: 'run' } : path.endsWith('/cancel') ? Response.json({ code: 'unavailable', message: 'Still going.' }, { status: 503 })
    : { sequence: 1, state: 'completed', rows: 0, range: null });
  const run = (await connected())!.start(request);
  const observe = async () => { for await (const _update of run.updates()) { /* Drain metadata. */ } };
  await expect(observe()).rejects.toMatchObject({ code: 'protocol' });
  await expect(run.cancel()).rejects.toThrow('Still going.');
});

it('uploads a request in one body, delivers terminal state to a slow observer, and offers its files where the service keeps them', async () => {
  let form: FormData | undefined;
  solver((path, init) => {
    if (path !== '/api/solver/runs') return completed;
    form = init!.body as FormData;
    return { id: 'run' };
  });
  const run = (await connected())!.start(request), observer = run.updates()[Symbol.asyncIterator]();
  expect((await observer.next()).value.state).toBe('preparing');
  for await (const update of run.updates()) if (update.state === 'completed') break;
  expect(JSON.parse(await (form!.get('solver') as File).text())).toEqual(request.study);
  expect(await (form!.get('model') as File).text()).toBe('{"buses":[]}');
  expect((await observer.next()).value).toEqual({ state: 'completed', progress: { rows: 10, range: [0, 1] } });
  expect((await observer.next()).done).toBe(true);
  expect((await run.artifacts).map(artifact => 'href' in artifact && artifact.href))
    .toEqual(['/api/solver/runs/run/results', '/api/solver/runs/run/log', '/api/solver/runs/run/solver']);
});

it('shows no progress until a row is recorded', async () => {
  const statuses = [{ sequence: 1, state: 'running', rows: 0, range: null }, { sequence: 2, state: 'running', rows: 3, range: [0, .2] }, completed];
  const fetch = solver(path => path === '/api/solver/runs' ? { id: 'run' } : statuses.shift());
  const updates = [];
  for await (const update of (await connected())!.start(request).updates()) updates.push(update.progress);
  expect(updates.at(-3)).toBeNull();
  expect(updates.slice(-2)).toEqual([{ rows: 3, range: [0, .2] }, { rows: 10, range: [0, 1] }]);
  // Each wait resumes after the last state it heard.
  expect(fetch.mock.calls.map(([url]) => url).filter(url => url.includes('?'))).toEqual(['/api/solver/runs/run?after=-1', '/api/solver/runs/run?after=1', '/api/solver/runs/run?after=2']);
});

it('abandons an upload still going, leaving nothing to stop', async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/solver/') return new Response(null, { status: 204 });
    return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
  });
  vi.stubGlobal('fetch', fetch);
  const run = (await connected())!.start(request);
  await run.cancel();
  const states = [];
  for await (const update of run.updates()) states.push(update.state);
  expect(states.at(-1)).toBe('cancelled');
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/solver/', '/api/solver/runs']);
});

it('stops a run through its address once it is accepted', async () => {
  let cancelled = false;
  const fetch = solver(path => {
    if (path === '/api/solver/runs') return { id: 'run' };
    if (path.endsWith('/cancel')) { cancelled = true; return new Response(null, { status: 204 }); }
    if (cancelled) return { sequence: 2, state: 'cancelled', rows: 4, range: [0, 1] };
    // A long-poll answers when something changes, never at once with what was already heard.
    return new Promise<Response>(resolve => setTimeout(() => resolve(Response.json({ sequence: 1, state: 'running', rows: 4, range: [0, 1] })), 5));
  });
  const run = (await connected())!.start(request);
  for await (const update of run.updates()) if (update.state === 'running') break;
  await run.cancel();
  expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/solver/runs/run/cancel');
  let last;
  for await (const update of run.updates()) last = update;
  expect(last).toEqual({ state: 'cancelled', progress: { rows: 4, range: [0, 1] } });
});

it('reads beneath the run\'s address what it was asked, and says what the service says of a failure', async () => {
  let asked: unknown;
  solver((path, init) => {
    if (path === '/api/solver/runs') return { id: 'run' };
    if (path === '/api/solver/runs/run/rows') {
      asked = JSON.parse(init!.body as string);
      return new Response(frame({ rows: 7, state: 'completed', range: [0, 1], first: 5, count: 2 }, Float64Array.of(0, 1, 10, 11)));
    }
    if (path === '/api/solver/runs/run/summary') return Response.json({ code: 'expired', message: 'This simulation has expired.' }, { status: 410 });
    return completed;
  });
  const run = (await connected())!.start(request);
  for await (const _update of run.updates()) { /* Until it completes. */ }
  const reader = openReader(await run.results());
  const { samples } = await reader.rows({ columns: ['v'], from: 5, every: 2, wait: true, maxBytes: 64 });
  expect(asked).toEqual({ columns: ['v'], from: 5, every: 2, wait: true, maxBytes: 64 });
  expect({ first: samples.first, times: [...samples.times], values: [...samples.values] }).toEqual({ first: 5, times: [0, 1], values: [10, 11] });
  await expect(reader.summary({ columns: ['v'], range: null, resolution: 10, maxBytes: 4096 })).rejects.toMatchObject({ code: 'expired', message: 'This simulation has expired.' });
  reader.close();
});
