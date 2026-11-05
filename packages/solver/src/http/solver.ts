import { client } from '../client.js';
import type { Solver } from '../index.js';
import { inThread } from '../serve.js';
import type { Options } from './index.js';

export async function solver(options: Options, signal?: AbortSignal): Promise<Solver | null> {
  const solver = typeof Worker === 'function' ? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    : inThread((await import('./backend.js')).open);
  return client(solver, options, signal);
}
