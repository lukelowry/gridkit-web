import { SolverError } from '../index.js';
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

/** Every run's store, in the origin's private file system: gridkit-runs/<run>/, a file per level. */
const runs = navigator.storage.getDirectory().then(root => root.getDirectoryHandle('gridkit-runs', { create: true }));

async function files(run: string): Promise<RunFiles> {
  const parent = await runs, directory = await parent.getDirectoryHandle(run, { create: true });
  return {
    async open(level) {
      const file = await directory.getFileHandle(level ? `level-${level}.bin` : 'samples.bin', { create: true });
      const handle = await file.createSyncAccessHandle();
      handle.truncate(0);
      return { read: (into, at) => handle.read(into, { at }), write: (from, at) => handle.write(from, { at }), close: () => handle.close() };
    },
    remove: () => parent.removeEntry(run, { recursive: true }),
  };
}

// Opening checks this browser can keep runs on disk, readies GridKit from its module, and clears what closed tabs left.
serve<Options>(async ({ module }, report) => {
  if (!('createSyncAccessHandle' in FileSystemFileHandle.prototype)) throw new SolverError('unavailable', 'This browser cannot keep simulation results on disk.');
  const studies = gridkit(module, () => new Worker(new URL('./gridkit.worker.ts', import.meta.url), { type: 'module' }),
    () => WebAssembly.compileStreaming(fetch(module.replace(/\.mjs$/, '.wasm'))));
  const parent = await runs;
  // A run another tab still holds keeps its files open, so it stays.
  for await (const name of parent.keys()) await parent.removeEntry(name, { recursive: true }).catch(() => {});
  return wasmBackend({ files, gridkit: studies }, report);
});
