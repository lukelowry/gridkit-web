/**
 * Cloudflare: its assets serve the editor, and this answers api/library/ from the library Worker bound to this one, which sees
 * the rest of the path as its own root. Studies run in the page, so there is no other service here.
 */
export interface Env {
  /** What this Worker uses of its binding to the library Worker. */
  readonly LIBRARY: { fetch(url: URL, init: RequestInit): Promise<Response> };
  /** The library's token, a Worker secret, where the library keeps one. */
  readonly GRIDKIT_LIBRARY_TOKEN?: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/library/')) {
      return Response.json({ code: 'missing', message: 'This editor has no such service.' }, { status: 404 });
    }
    // Only what the library reads goes on; the browser's cookies never do.
    const headers = new Headers();
    for (const name of ['accept', 'if-none-match']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (env.GRIDKIT_LIBRARY_TOKEN) headers.set('authorization', `Bearer ${env.GRIDKIT_LIBRARY_TOKEN}`);
    return env.LIBRARY.fetch(new URL(url.pathname.slice('/api/library'.length) + url.search, url),
      { method: request.method, headers, signal: request.signal });
  },
};
