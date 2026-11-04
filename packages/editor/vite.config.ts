import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

/** The checkout, whose .env (copied from .env.example) every program here reads; the environment overrides it. */
const checkout = fileURLToPath(new URL('../..', import.meta.url));

/** latkit's WebAssembly, which every view needs, downloads with the page rather than once the editor's code has run. */
const preloadLatkit: Plugin = {
  name: 'gridkit-preload-latkit',
  apply: 'build',
  transformIndexHtml: { order: 'post', handler(_html, { bundle }) {
    const wasm = Object.keys(bundle ?? {}).find(name => /^assets\/latkit_bg-.+\.wasm$/.test(name));
    // latkit fetches it from this page with fetch's defaults, which the preload matches so the download is reused.
    return wasm ? [{ tag: 'link', injectTo: 'head', attrs: { rel: 'preload', href: `./${wasm}`, as: 'fetch', type: 'application/wasm', crossorigin: '' } }] : [];
  } },
};

/**
 * `pnpm dev`: a service beside the editor at api/<name>/, as every deployment mounts it, which sees the rest as its own root:
 * the one .env names, with its token, else this machine's own at its port, which is simply not there while it isn't running.
 */
function beside(env: Record<string, string>, name: 'solver' | 'library'): ProxyOptions {
  const setting = (field: string) => env[`GRIDKIT_${name.toUpperCase()}_${field}`]?.trim();
  const named = setting('URL'), token = setting('TOKEN'), port = Number(setting('PORT'));
  if (!named && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new Error(`GRIDKIT_${name.toUpperCase()}_PORT must be a port number; copy .env.example to .env.`);
  }
  const failure = (response: ServerResponse, status: number, message: string) => {
    if (!response.headersSent) response.writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ code: status === 404 ? 'missing' : 'unavailable', message }));
  };
  return {
    target: named || `http://127.0.0.1:${port}`,
    changeOrigin: true,
    rewrite: path => path.slice(`/api/${name}`.length),
    ...token && { headers: { authorization: `Bearer ${token}` } },
    configure: proxy => proxy.on('error', (_error, _request, response) => {
      if (!('req' in response)) return;
      if (named) failure(response, 502, `Cannot reach the ${name} service at ${new URL(named).origin}.`);
      else failure(response, 404, `This editor has no ${name} service.`);
    }),
  };
}

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, checkout, 'GRIDKIT_');
  const dev = command === 'serve' && !isPreview && !process.env.VITEST;
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    // Relative, so one build serves from any path; the editor finds config.json, and its services, beside it.
    base: './',
    plugins: [svelte(), preloadLatkit],
    server: dev ? { proxy: { '/api/solver/': beside(env, 'solver'), '/api/library/': beside(env, 'library') } } : {},
    // The preview serves the build as a static site would: nothing beside it.
    preview: { proxy: {} },
    // The solver in the page starts GridKit's worker from its own, which imports the module at run time.
    worker: { format: 'es' as const },
    // latkit finds its WebAssembly and worker beside its modules, which pre-bundling would move.
    optimizeDeps: { exclude: ['latkit'] },
    // `pnpm smoke` drives the running stack; everything else runs without one.
    test: { include: mode === 'smoke' ? ['tests/*.smoke.ts'] : ['src/**/*.test.ts'], environment: 'node', env },
  };
});
