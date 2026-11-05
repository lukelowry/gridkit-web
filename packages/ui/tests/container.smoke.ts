import { parseCase } from '@gridkit/library';
import { connect } from '@gridkit/library/http';
import { describe, expect, it } from 'vitest';
import headers from '../headers.json' with { type: 'json' };

/** The running stack's UI container, as its Caddyfile serves the UI and mounts each service beside it: `pnpm smoke`. */
const page = 'http://127.0.0.1:8080/';
const mounted = (name: string) => new URL(`api/${name}/`, page).href;

describe('the UI container', () => {
  it('serves the UI with its browser policy and what it says to it, and mounts its services alone', async () => {
    const answer = await fetch(page);
    expect(answer.status).toBe(200);
    for (const [name, value] of Object.entries(headers)) expect(answer.headers.get(name)).toBe(value);
    expect(await (await fetch(new URL('config.json', page))).json()).toEqual({});
    expect((await fetch(new URL('assets/missing.js', page))).status).toBe(404);
    expect((await fetch(new URL('api/missing/', page))).status).toBe(404);
    expect((await fetch(mounted('solver'))).status).toBe(204);
    expect((await fetch(`${mounted('solver')}runs/missing`, { headers: { Origin: 'https://foreign.test' } })).status).toBe(403);
  });

  // Whatever library the stack names, through the UI's own client: the local folder, or a bucket on Cloudflare.
  it('mounts its library, read-only, whose cases open as any case file does', async () => {
    const library = (await connect({ base: mounted('library') }))!;
    expect(library).not.toBeNull();
    const cases = (await library.list('')).filter(entry => !entry.folder);
    expect(cases.length, 'The library holds a case to open.').toBeGreaterThan(0);
    // The smallest, so the check stays quick whatever the library holds.
    const smallest = cases.reduce((least, entry) => entry.size < least.size ? entry : least);
    expect(parseCase(await (await library.open(smallest)).text()).header).toBeDefined();
    const url = mounted('library') + encodeURIComponent(smallest.path);
    const file = await fetch(url);
    expect(file.headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(url, { headers: { 'If-None-Match': file.headers.get('etag')! } })).status).toBe(304);
    const write = await fetch(url, { method: 'PUT', body: '{}' });
    expect(write.status).toBe(405);
    expect(await write.json()).toMatchObject({ code: 'read-only' });
    expect(await (await fetch(`${mounted('library')}missing.case.json`)).json()).toMatchObject({ code: 'missing' });
    expect((await fetch(mounted('library'), { headers: { Origin: 'https://foreign.test' } })).status).toBe(403);
  });
});
