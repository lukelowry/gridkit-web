/**
 * The library on Cloudflare: the files in an R2 bucket, answered as the library image answers with its folder. GET <folder>/
 * lists a folder as JSON (name, size, mod_time, is_dir) and GET <path> is a file. Upload files to the bucket to change it.
 * Any page may read it: the UI asks it directly, wherever the UI is hosted.
 */
import type { ListingEntry } from '@gridkit/library/http';

/** What this Worker uses of its R2 binding. */
export interface Bucket {
  list(options: { prefix: string; delimiter: string; cursor?: string }): Promise<{
    readonly objects: readonly { readonly key: string; readonly size: number; readonly uploaded: Date }[];
    readonly delimitedPrefixes: readonly string[];
    readonly truncated: boolean;
    readonly cursor?: string;
  }>;
  /** A file, without its body where `onlyIf`'s preconditions fail; null where there is none. */
  get(key: string, options: { onlyIf: Headers }): Promise<{
    readonly httpEtag: string;
    readonly size: number;
    readonly httpMetadata?: { readonly contentType?: string };
    readonly body?: ReadableStream;
  } | null>;
}
export interface Env { readonly LIBRARY: Bucket }

const headers = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' };
const failure = (code: string, message: string, status: number, more: Record<string, string> = {}) =>
  Response.json({ code, message }, { status, headers: { ...headers, ...more } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return new Response(null, { status: 204 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return failure('read-only', 'The library is read-only.', 405, { Allow: 'GET, HEAD' });
    let key: string;
    try { key = decodeURIComponent(pathname.slice(1)); } catch { return failure('invalid', 'Invalid path.', 400); }
    if (key === '' || key.endsWith('/')) {
      const entries = await listing(env.LIBRARY, key);
      return key && !entries.length ? failure('missing', 'The library has no such folder.', 404) : Response.json(entries, { headers });
    }
    const file = await env.LIBRARY.get(key, { onlyIf: request.headers });
    if (!file) return failure('missing', 'The library has no such file.', 404);
    const answer = { ...headers, ETag: file.httpEtag,
      'Content-Type': file.httpMetadata?.contentType ?? (key.endsWith('.json') ? 'application/json' : 'application/octet-stream') };
    if (!file.body) return new Response(null, { status: 304, headers: answer });
    return new Response(request.method === 'HEAD' ? null : file.body, { headers: { ...answer, 'Content-Length': String(file.size) } });
  },
};

/** A folder's files and folders, as Caddy's file_server lists one: folders end in a slash, and hidden names are left out. */
async function listing(bucket: Bucket, prefix: string) {
  const entries: ListingEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, delimiter: '/', ...cursor && { cursor } });
    for (const folder of page.delimitedPrefixes) entries.push({ name: folder.slice(prefix.length), size: 0, is_dir: true });
    for (const file of page.objects) entries.push({ name: file.key.slice(prefix.length), size: file.size, mod_time: file.uploaded.toISOString(), is_dir: false });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return entries.filter(entry => entry.name && !entry.name.startsWith('.'));
}
