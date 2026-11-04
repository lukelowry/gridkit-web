import { errorMessage } from '../ui/errors.js';

/** The first wait before trying a failed connection again, and the longest, doubling between them. */
const firstRetry = 2_000, lastRetry = 30_000;

/** absent: there is none. connecting: being asked the first time. ready: answering. unreachable: named, not answering. */
export type ConnectionStatus = 'absent' | 'connecting' | 'ready' | 'unreachable';

/**
 * A service the editor may find beside it, which `open` connects to, answering null where there is none. A
 * failure is tried again, waiting longer each time, since a service often starts after the editor; coming back to the
 * editor asks again whatever is not answering, so a service started later appears.
 */
export class Connection<T> {
  value = $state.raw<T | null>(null);
  error = $state('');
  /** Whether it is being asked now. */
  pending = $state(false);
  #absent = $state(false);
  #retry: ReturnType<typeof setTimeout> | undefined;
  #wait = firstRetry;
  readonly #open: (signal: AbortSignal) => Promise<T | null>;

  constructor(open: (signal: AbortSignal) => Promise<T | null>) { this.#open = open; }

  get status(): ConnectionStatus {
    return this.value ? 'ready' : this.#absent ? 'absent' : this.error ? 'unreachable' : 'connecting';
  }

  async connect() {
    if (this.pending) return;
    clearTimeout(this.#retry);
    this.pending = true;
    try {
      this.value = await this.#open(AbortSignal.timeout(8_000));
      this.#absent = this.value === null; this.error = ''; this.#wait = firstRetry;
    } catch (cause) {
      this.value = null; this.#absent = false; this.error = errorMessage(cause);
      this.#retry = setTimeout(() => void this.connect(), this.#wait);
      this.#wait = Math.min(this.#wait * 2, lastRetry);
    } finally { this.pending = false; }
  }

  /** Asks again now whatever is not answering, as when the editor is shown again. */
  recover() { if (this.status !== 'ready') void this.connect(); }
}
