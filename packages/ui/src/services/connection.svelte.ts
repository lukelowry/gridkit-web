import { errorMessage } from '../ui/errors.js';

/** The first wait before trying a failed connection again, and the longest, doubling between them. */
const firstRetry = 2_000, lastRetry = 30_000;

/** absent: there is none. connecting: being asked the first time. ready: answering. unreachable: named, not answering. */
export type ConnectionStatus = 'absent' | 'connecting' | 'ready' | 'unreachable';

/**
 * A service the UI may find beside it, which `open` connects to, answering null where there is none. A
 * failure is tried again, waiting longer each time, since a service often starts after the UI; coming back to the
 * UI asks again whatever is not answering, so a service started later appears.
 */
export class Connection<T> {
  value = $state.raw<T | null>(null);
  error = $state('');
  /** Whether it is being asked now. */
  pending = $state(false);
  #absent = $state(false);
  #retry: ReturnType<typeof setTimeout> | undefined;
  #wait = firstRetry;
  #disposed = false;
  #abort: AbortController | undefined;
  readonly #open: (signal: AbortSignal) => Promise<T | null>;
  readonly #release: ((value: T) => void) | undefined;

  constructor(open: (signal: AbortSignal) => Promise<T | null>, release?: (value: T) => void) {
    this.#open = open; this.#release = release;
  }

  get status(): ConnectionStatus {
    return this.value ? 'ready' : this.#absent ? 'absent' : this.error ? 'unreachable' : 'connecting';
  }

  async connect() {
    if (this.pending || this.#disposed || this.value !== null) return;
    clearTimeout(this.#retry);
    this.pending = true;
    const abort = this.#abort = new AbortController();
    try {
      const value = await this.#open(AbortSignal.any([abort.signal, AbortSignal.timeout(8_000)]));
      if (this.#disposed) { if (value !== null) this.#release?.(value); return; }
      this.value = value;
      this.#absent = this.value === null; this.error = ''; this.#wait = firstRetry;
    } catch (cause) {
      if (this.#disposed) return;
      this.value = null; this.#absent = false; this.error = errorMessage(cause);
      this.#retry = setTimeout(() => void this.connect(), this.#wait);
      this.#wait = Math.min(this.#wait * 2, lastRetry);
    } finally { this.#abort = undefined; this.pending = false; }
  }

  /** Asks again now whatever is not answering, as when the UI is shown again. */
  recover() { if (this.status !== 'ready') void this.connect(); }

  /** Ends retries and releases the service, including one that finishes connecting after removal. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#retry);
    this.#abort?.abort();
    const value = this.value;
    this.value = null; this.pending = false; this.#absent = true; this.error = '';
    if (value !== null) this.#release?.(value);
  }
}
