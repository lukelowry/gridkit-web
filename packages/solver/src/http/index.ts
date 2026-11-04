import type { Solver } from '../index.js';
import { solver } from './solver.js';

export interface Options {
  /** The service's root, where it answers: GET <base> says it is there, and its runs are beneath <base>runs/. */
  readonly base: string;
}

/**
 * A solver service at `options.base`, or null where none answers there. It is followed and read in a worker of its own, so the
 * page's thread only hears what changed; where there are no workers, as in Node, in this thread.
 */
export const connect: (options: Options, signal?: AbortSignal) => Promise<Solver | null> = solver;
