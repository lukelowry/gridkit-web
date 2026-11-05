import { isTerminal, type RunUpdate } from './index.js';
import type { RunStatus } from './protocol.js';

/** A run's status as an update. */
export const updateOf = (status: RunStatus): RunUpdate => {
  const progress = status.range && { rows: status.rows, range: status.range };
  if (status.state === 'completed') return { state: status.state, progress: progress! };
  return status.state === 'failed' ? { state: status.state, progress, error: status.error! } : { state: status.state, progress };
};

/** Iterator cancellation interrupts an outstanding next(). */
function observe<T>(read: (signal: AbortSignal) => AsyncGenerator<T>, signal?: AbortSignal): AsyncIterableIterator<T> {
  const stopped = new AbortController();
  const combined = signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal;
  const iterator = read(combined);
  return { [Symbol.asyncIterator]() { return this; }, next: () => iterator.next(),
    async return() { stopped.abort(); try { await iterator.return(undefined); } catch { /* Closing the observation. */ } return { done: true, value: undefined }; },
  };
}

/** A run's updates as each watcher sees them: the latest at once, then each newer one, until the run ends or following it fails. */
export class RunUpdates {
  current: RunUpdate = { state: 'preparing', progress: null };
  #version = 0;
  #failure: unknown;
  #finished = false;
  #listeners = new Set<() => void>();
  #end!: { resolve(): void; reject(cause: unknown): void };
  /** Settles once the run ends, or rejects as following it failed. */
  readonly ended = new Promise<void>((resolve, reject) => { this.#end = { resolve, reject }; });

  publish(update: RunUpdate) {
    this.current = update; this.#version++; this.#wake();
    if (isTerminal(update.state)) this.#end.resolve();
  }
  /** Nothing more is heard; a failure ends each watch with it. */
  finish(failure?: unknown) {
    this.#failure = failure; this.#finished = true; this.#wake();
    if (failure) this.#end.reject(failure); else this.#end.resolve();
  }
  #wake() { for (const wake of [...this.#listeners]) wake(); }

  watch(signal?: AbortSignal): AsyncIterable<RunUpdate> {
    const updates = this;
    return observe(async function* (stop) {
      let seen = -1;
      while (true) {
        stop.throwIfAborted();
        if (seen !== updates.#version) { seen = updates.#version; yield updates.current; continue; }
        if (updates.#failure) throw updates.#failure;
        if (updates.#finished || isTerminal(updates.current.state)) return;
        await new Promise<void>((wake, fail) => {
          const done = () => { updates.#listeners.delete(done); stop.removeEventListener('abort', abort); wake(); };
          const abort = () => { updates.#listeners.delete(done); fail(stop.reason); };
          updates.#listeners.add(done); stop.addEventListener('abort', abort, { once: true });
          if (seen !== updates.#version || updates.#finished || stop.aborted) done();
        });
      }
    }, signal);
  }
}
