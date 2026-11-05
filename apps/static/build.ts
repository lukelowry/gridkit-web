// `pnpm deploy:web` and `pnpm preview:web` build this into dist/: the editor, GridKit's module beside it, what the editor is
// told, and its browser policy as Cloudflare reads it.
import type { Config } from '@gridkit/editor/config';
import headers from '@gridkit/editor/headers.json' with { type: 'json' };
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { gridkit } from './gridkit.ts';

/** The library every copy of this site reads: the library Worker, which any page may read. */
const library = 'https://gridkit-library.lukel.workers.dev/';
const editor = dirname(createRequire(import.meta.url).resolve('@gridkit/editor/package.json'));
const dist = new URL('dist/', import.meta.url);

await build({ configFile: join(editor, 'vite.config.ts'), build: { outDir: fileURLToPath(dist), emptyOutDir: true } });
const config: Config = { gridkit: await gridkit(dist), library };
await writeFile(new URL('config.json', dist), JSON.stringify(config));
// Vite names each built asset by its content, and gridkit/ holds GridKit beneath its image's digest: neither ever changes.
const kept = '  Cache-Control: public, max-age=31536000, immutable\n';
await writeFile(new URL('_headers', dist),
  `/*\n${Object.entries(headers).map(([name, value]) => `  ${name}: ${value}\n`).join('')}/assets/*\n${kept}/gridkit/*\n${kept}`);
