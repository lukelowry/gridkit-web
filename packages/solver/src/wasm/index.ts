import type { Solver } from '../index.js';
import { solver } from './solver.js';

export interface Options {
  /** GridKit's module, DynamicSimulation.mjs, with its .wasm beside it. */
  readonly module: string;
}

/** GridKit in this page: a worker of its own runs each study, and keeps each run in the origin's private files until the next. */
export const connect: (options: Options, signal?: AbortSignal) => Promise<Solver | null> = solver;
