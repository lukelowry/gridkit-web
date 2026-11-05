import { client } from '../client.js';
import type { Solver } from '../index.js';
import type { Options } from './index.js';

export function solver(options: Options, signal?: AbortSignal): Promise<Solver | null> {
  return client(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), options, signal);
}
