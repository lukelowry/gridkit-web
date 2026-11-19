/** Yield between bounded batches while retaining backpressure; cancellation also wakes a hidden page. */
export class Pace {
  #spent = 0;
  spend(work: () => void) {
    const started = performance.now();
    work();
    this.#spent += performance.now() - started;
  }
  async ready(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.#spent < 4) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { cancelAnimationFrame(frame); reject(signal.reason); };
      const frame = requestAnimationFrame(() => { signal.removeEventListener('abort', abort); resolve(); });
      signal.addEventListener('abort', abort, { once: true });
    });
    this.#spent = 0;
    signal.throwIfAborted();
  }
}
