import { SolverError, type Engine } from '../index.js';
import { serve } from '../serve.js';
import { wasmBackend } from './backend.js';
import { gridkit } from './gridkit.js';
import type { RunFiles } from './host.js';
import type { Options } from './index.js';

// OPFS's synchronous access, which the DOM library leaves to workers.
declare global {
  interface FileSystemSyncAccessHandle {
    read(into: Uint8Array, options: { at: number }): number;
    write(from: Uint8Array, options: { at: number }): number;
    truncate(size: number): void;
    close(): void;
  }
  interface FileSystemFileHandle { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }
}

/** No OPFS sync access: permanent, so never retried. */
const unsupported = () => new SolverError('unsupported', 'This browser cannot keep simulation results on disk.');
/** The Web Lock a tab holds while it owns a run's files. */
const lock = (run: string) => `gridkit-run:${run}`;

/** A run's files in OPFS, gridkit-runs/<run>/, locked until removed so other tabs' cleanup skips it. */
async function files(parent: FileSystemDirectoryHandle, run: string): Promise<RunFiles> {
  let release!: () => void;
  await new Promise<void>(held => void navigator.locks.request(lock(run), () => { held(); return new Promise<void>(done => { release = done; }); }));
  const directory = await parent.getDirectoryHandle(run, { create: true }).catch((cause: unknown) => { release(); throw cause; });
  return {
    async open(level) {
      const file = await directory.getFileHandle(level ? `level-${level}.bin` : 'samples.bin', { create: true });
      const handle = await file.createSyncAccessHandle();
      handle.truncate(0);
      return { read: (into, at) => handle.read(into, { at }), write: (from, at) => handle.write(from, { at }), close: () => handle.close() };
    },
    remove: () => parent.removeEntry(run, { recursive: true }).finally(release),
  };
}

// Opening checks OPFS, clears runs no open tab holds, and readies GridKit.
serve<Options>(async ({ module }, report) => {
  if (!('createSyncAccessHandle' in FileSystemFileHandle.prototype)) throw unsupported();
  const parent = await navigator.storage.getDirectory()
    .then(root => root.getDirectoryHandle('gridkit-runs', { create: true })).catch(() => { throw unsupported(); });
  for await (const name of parent.keys()) await navigator.locks.request(lock(name), { ifAvailable: true },
    held => held ? parent.removeEntry(name, { recursive: true }).catch(() => {}) : undefined);
  // GridKit's versions.json; {} if unavailable (display only).
  const engine: Engine = await fetch(new URL('versions.json', module)).then(said => said.ok ? said.json() : {}).catch(() => ({}));
  const studies = gridkit(module, () => new Worker(new URL('./gridkit.worker.ts', import.meta.url), { type: 'module' }),
    () => WebAssembly.compileStreaming(fetch(module.replace(/\.mjs$/, '.wasm'))));
  return wasmBackend({ files: run => files(parent, run), gridkit: studies, engine }, report);
});
