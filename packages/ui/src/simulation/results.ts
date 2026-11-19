import { Tiles } from 'latkit';
import type { NetworkFeed, NetworkPage, TileSet } from './results.worker.js';
import { plotDataset } from './plot.js';

/** What the page asks of a run's results worker, each answered once by its id: its run's port, each feed of it by number, and tiles. */
export type ResultsCommand =
  | { kind: 'open'; port: MessagePort; width: number }
  | { kind: 'follow'; feed: number; request: NetworkFeed }
  | { kind: 'next'; feed: number }
  | { kind: 'stop'; feed: number }
  | { kind: 'tile'; set: TileSet; path: string };
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

/** A tile set as the plot reads it: its tiles, and how many rows the run had recorded when they last caught up with it. */
interface TileState { readonly tiles: Tiles; rows: number }

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
  /** Each tile set asked for, by its measure: shown again, it draws what it fetched. */
  #tiles = new Map<string, TileState>();
  /** The set asked for last, which the plot draws. */
  #shown: TileState | undefined;
  /** How many rows the run has recorded, as it last said. */
  #rows = 0;

  /** Reads the run whose port `port` gives, once it does: `width` columns, a channel each. */
  constructor(port: Promise<MessagePort>, width: number) {
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
      return this.#request({ kind: 'open', port: opened, width }, undefined, [opened]);
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
  async follow(request: NetworkFeed, signal: AbortSignal, apply: (page: NetworkPage) => void | Promise<void>) {
    await this.#opened;
    signal.throwIfAborted();
    const feed = this.#feeds++;
    try {
      await this.#request({ kind: 'follow', feed, request }, signal);
      while (true) {
        const page = await this.#request<NetworkPage | null>({ kind: 'next', feed }, signal);
        if (!page) return;
        await apply(page);
        signal.throwIfAborted();
      }
    } finally { void this.#request({ kind: 'stop', feed }).catch(() => {}); }
  }
  /**
   * `set`'s time tiles, which latkit fetches through this worker as the plot window needs them. One per set: a set asked for again
   * draws what it fetched, and catches up with what the run recorded since.
   */
  tiles(set: TileSet): Tiles {
    const key = JSON.stringify(set);
    let state = this.#tiles.get(key);
    if (!state) {
      // Each file once the run's port is open; tiles not drawn yet read the run as it is when they are.
      const fetch = async (url: string) => {
        await this.#opened;
        return this.#request<Uint8Array>({ kind: 'tile', set, path: url.slice(url.indexOf('/') + 1) });
      };
      this.#tiles.set(key, state = { tiles: new Tiles(plotDataset, `plot:${this.#tiles.size}/frames.json`, { fetch }), rows: this.#rows });
    }
    this.#shown = state;
    this.#catchUp();
    return state.tiles;
  }
  /** The run has recorded `rows`: the tiles shown fetch what they lack of them. */
  recorded(rows: number) {
    this.#rows = rows;
    this.#catchUp();
  }
  /**
   * Refreshes the tiles shown when the run has recorded rows since they last caught up. latkit lands a file being fetched first,
   * then fetches it once more however often they were refreshed meanwhile, so each new row asks for no more than that.
   */
  #catchUp() {
    const shown = this.#shown;
    if (!shown || shown.rows >= this.#rows) return;
    shown.rows = this.#rows;
    shown.tiles.refresh();
  }
  /** Ends every feed; the worker lets the run's port go, then ends itself. */
  close(error: Error = new DOMException('The result worker closed.', 'AbortError')) {
    if (this.#closed) return;
    this.#closed = error;
    this.#worker.postMessage({ kind: 'close' } satisfies ResultsMessage);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#tiles.clear();
    this.#shown = undefined;
  }
}
