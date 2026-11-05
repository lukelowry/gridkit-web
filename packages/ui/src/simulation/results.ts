import type { FeedRequest, NetworkFeed, NetworkPage, PlotFeedRequest, PlotPage } from './results.worker.js';

/** What the page asks of a run's results worker, each answered once by its id: its run's port, then each feed of it by number. */
export type ResultsCommand =
  | { kind: 'open'; port: MessagePort }
  | { kind: 'follow'; feed: number; request: FeedRequest }
  | { kind: 'next'; feed: number }
  | { kind: 'stop'; feed: number };
/** Each command, and the last word: the worker lets the run's port go, and ends. */
export type ResultsMessage = (ResultsCommand & { id: number }) | { kind: 'close' };
export interface ResultsReply {
  id: number;
  value?: unknown;
  error?: { name: string; message: string; code?: string };
}

/** One live task: starting another stops it, and a stopped task never reports. */
export class Feed {
  #current: AbortController | undefined;
  start(task: (signal: AbortSignal) => Promise<unknown>, failed: (cause: unknown) => void) {
    this.#current?.abort();
    const abort = this.#current = new AbortController();
    void task(abort.signal).catch(cause => { if (!abort.signal.aborted) failed(cause); });
  }
  stop() { this.#current?.abort(); this.#current = undefined; }
}

/** What a run says when its results cannot be read, as when the files this page was built with are gone since it opened. */
const unreadable = "This run's results could not be read. Download the case, then reload the page.";

/**
 * A run's results, read off the main thread in one worker however many views follow them: small commands in, rendering buffers
 * moved out. Each feed pulls a page only once the last is applied, so a hidden or slow view queues nothing.
 */
export class RunResults {
  #worker: Worker;
  #id = 0;
  #feeds = 0;
  #pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  #closed: Error | undefined;
  #opened: Promise<unknown>;

  /** Reads the run whose port `port` gives, once it does. */
  constructor(port: Promise<MessagePort>) {
    this.#worker = new Worker(new URL('./results.worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }: MessageEvent<ResultsReply>) => {
      const pending = this.#pending.get(data.id);
      this.#pending.delete(data.id);
      if (data.error) pending?.reject(Object.assign(new Error(data.error.message), data.error)); else pending?.resolve(data.value);
    };
    // A worker that faulted cannot close itself.
    const fault = (error: Error) => { this.close(error); this.#worker.terminate(); };
    this.#worker.onerror = event => { event.preventDefault(); fault(new Error(event.message || unreadable)); };
    this.#worker.onmessageerror = () => fault(new Error('Cannot decode the result worker\'s reply.'));
    this.#opened = port.then(opened => {
      if (this.#closed) { opened.close(); throw this.#closed; }
      return this.#request({ kind: 'open', port: opened }, undefined, [opened]);
    });
    // A feed hears why it could not open.
    this.#opened.catch(() => {});
  }
  #request<T>(command: ResultsCommand, signal?: AbortSignal, transfer: Transferable[] = []): Promise<T> {
    if (this.#closed) return Promise.reject(this.#closed);
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = this.#id++;
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.#pending.delete(id); signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal!.reason); };
      this.#pending.set(id, {
        resolve: value => { cleanup(); resolve(value as T); },
        reject: error => { cleanup(); reject(error); },
      });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.#worker.postMessage({ ...command, id } satisfies ResultsMessage, { transfer }); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  /** Reads `request` beside any other feed, and applies each page before asking for the next, until it ends or `signal` aborts. */
  follow(request: NetworkFeed, signal: AbortSignal, apply: (page: NetworkPage) => void | Promise<void>): Promise<void>;
  follow(request: PlotFeedRequest, signal: AbortSignal, apply: (page: PlotPage) => void | Promise<void>): Promise<void>;
  async follow(request: FeedRequest, signal: AbortSignal, apply: (page: never) => void | Promise<void>) {
    await this.#opened;
    signal.throwIfAborted();
    const feed = this.#feeds++;
    try {
      await this.#request({ kind: 'follow', feed, request }, signal);
      while (true) {
        const page = await this.#request<NetworkPage | PlotPage | null>({ kind: 'next', feed }, signal);
        if (!page) return;
        await apply(page as never);
        signal.throwIfAborted();
      }
    } finally { void this.#request({ kind: 'stop', feed }).catch(() => {}); }
  }
  /** Ends every feed; the worker lets the run's port go, then ends itself. */
  close(error: Error = new DOMException('The result worker closed.', 'AbortError')) {
    if (this.#closed) return;
    this.#closed = error;
    this.#worker.postMessage({ kind: 'close' } satisfies ResultsMessage);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
