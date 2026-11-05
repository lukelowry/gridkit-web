import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

/** The files the static deployment serves beneath gridkit/: GridKit's module, and the licenses of what it is built from. */
const wanted = (path: string) => path === 'DynamicSimulation.mjs' || path === 'DynamicSimulation.wasm'
  || (path.startsWith('licenses/') && !path.split('/').includes('..'));
const manifests = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];

/** The GridKit the site runs in the page. */
const registry = 'ghcr.io', repository = 'birchfieldresearchgroup/gridkit-wasm', tag = 'develop-perf';
const image = `${registry}/${repository}:${tag}`;

interface Descriptor { mediaType: string; digest: string; platform?: { os: string; architecture: string } }
interface Manifest { mediaType?: string; manifests?: Descriptor[]; layers?: Descriptor[] }

/**
 * GridKit's module, from its image: fetched from its registry, each blob checked against its digest, and written into `into`
 * beneath gridkit/<digest>/. Named by its image, it never changes, so browsers keep it. Answers where the module is, relative
 * to `into`.
 */
export async function gridkit(into: URL): Promise<string> {
  const { digest, files } = await imageFiles();
  const folder = `gridkit/${digest.slice('sha256:'.length, 'sha256:'.length + 12)}`;
  for (const [path, content] of files) {
    const target = new URL(`${folder}/${path}`, into);
    await mkdir(new URL('.', target), { recursive: true });
    await writeFile(target, content);
  }
  return `${folder}/DynamicSimulation.mjs`;
}

async function imageFiles() {
  const base = `https://${registry}/v2/${repository}`, headers: Record<string, string> = {};
  /** A registry answers 401 with where to get a token for it; public images need no credentials there. */
  async function get(url: string, accept?: string): Promise<Response> {
    const ask = () => fetch(url, { headers: { ...headers, ...accept && { Accept: accept } } });
    let response = await ask();
    const challenge = response.status === 401 && response.headers.get('www-authenticate');
    if (challenge) {
      const fields = Object.fromEntries([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
      const token = await fetch(`${fields.realm}?${new URLSearchParams({ service: fields.service ?? '', scope: fields.scope ?? `repository:${repository}:pull` })}`);
      if (!token.ok) throw new Error(`${registry} refused a token for ${repository} (${token.status}).`);
      headers.Authorization = `Bearer ${((await token.json()) as { token: string }).token}`;
      response = await ask();
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
    return response;
  }
  /** What `reference` names, checked against it where it is a digest. */
  const content = async (kind: 'manifests' | 'blobs', reference: string) => {
    const bytes = new Uint8Array(await (await get(`${base}/${kind}/${reference}`, kind === 'manifests' ? manifests.join(', ') : undefined)).arrayBuffer());
    if (reference.startsWith('sha256:') && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== reference) throw new Error(`${reference} does not match its content.`);
    return bytes;
  };
  /** A manifest, and the digest that names it. */
  const manifest = async (reference: string) => {
    const bytes = await content('manifests', reference);
    return { digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, value: JSON.parse(new TextDecoder().decode(bytes)) as Manifest };
  };
  // A tag may name an index of platforms and attestations; the image itself is the one for linux/amd64.
  let found = await manifest(tag);
  if (found.value.manifests) {
    const platform = found.value.manifests.find(entry => entry.platform?.os === 'linux' && entry.platform.architecture === 'amd64');
    if (!platform) throw new Error(`${image} has no linux/amd64 image.`);
    found = await manifest(platform.digest);
  }
  const files = new Map<string, Uint8Array>();
  for (const layer of found.value.layers ?? []) {
    if (!/tar(\.|\+)gzip$|tar$/.test(layer.mediaType)) throw new Error(`${image} has a layer this build cannot read (${layer.mediaType}).`);
    const bytes = await content('blobs', layer.digest);
    for (const [path, content] of untar(layer.mediaType.endsWith('tar') ? bytes : gunzipSync(bytes))) if (wanted(path)) files.set(path, content);
  }
  if (!files.has('DynamicSimulation.mjs') || !files.has('DynamicSimulation.wasm')) throw new Error(`${image} holds no DynamicSimulation module.`);
  return { digest: found.digest, files };
}

/** A tar archive's regular files, by path. */
function* untar(archive: Uint8Array): Generator<[string, Uint8Array]> {
  const text = (start: number, length: number) => new TextDecoder().decode(archive.subarray(start, start + length)).replace(/\0.*$/s, '');
  for (let at = 0; at + 512 <= archive.length;) {
    const name = text(at, 100);
    if (!name) return;
    const size = parseInt(text(at + 124, 12).trim() || '0', 8), type = text(at + 156, 1), prefix = text(at + 345, 155);
    if (type === '0' || type === '') yield [`${prefix ? `${prefix}/` : ''}${name}`.replace(/^\.?\//, ''), archive.slice(at + 512, at + 512 + size)];
    at += 512 + Math.ceil(size / 512) * 512;
  }
}
