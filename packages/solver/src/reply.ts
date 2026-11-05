import { SolverError } from './index.js';
import type { Answer, Ask, Reply } from './protocol.js';

/** What a reader asks, rather than how it pulls an answer. */
export type Question = Extract<Ask, { op: 'rows' | 'summary' | 'artifact' }>;
type Questioning = Question extends infer Q ? Q extends Question ? Omit<Q, 'id'> : never : never;

/**
 * Answers each question asked through `port` with `respond`: parts at hand go with their header in one message, the rest one at a
 * time as the reader asks for them, so a slow reader holds back whatever makes them. Every part is moved, never copied.
 */
export function answer(port: MessagePort, respond: (question: Question, signal: AbortSignal) => Promise<Reply<unknown>>) {
  const open = new Map<number, { abort: AbortController; parts?: AsyncIterator<ArrayBuffer> }>();
  const post = (answer: Answer, transfer: Transferable[] = []) => port.postMessage(answer, { transfer });
  const stop = (id: number) => {
    const held = open.get(id);
    open.delete(id);
    held?.abort.abort();
    void held?.parts?.return?.()?.catch(() => {});
  };
  port.onmessage = async ({ data }: MessageEvent<Ask>) => {
    if (data.op === 'close') { for (const id of [...open.keys()]) stop(id); port.close(); return; }
    if (data.op === 'abort') { stop(data.id); return; }
    if (data.op === 'next') {
      const parts = open.get(data.id)?.parts;
      if (!parts) return;
      try {
        const next = await parts.next();
        if (!open.has(data.id)) return;
        if (next.done) { open.delete(data.id); post({ id: data.id, end: true }); } else post({ id: data.id, part: next.value }, [next.value]);
      } catch (cause) { if (open.delete(data.id)) post({ id: data.id, error: SolverError.of(cause) }); }
      return;
    }
    const held = { abort: new AbortController() } as { abort: AbortController; parts?: AsyncIterator<ArrayBuffer> };
    open.set(data.id, held);
    try {
      const { header, parts } = await respond(data, held.abort.signal);
      if (!open.has(data.id)) return;
      if (Symbol.asyncIterator in parts) { held.parts = parts[Symbol.asyncIterator](); post({ id: data.id, header, parts: [], more: true }); }
      else { open.delete(data.id); post({ id: data.id, header, parts, more: false }, [...parts]); }
    } catch (cause) { if (open.delete(data.id)) post({ id: data.id, error: SolverError.of(cause) }); }
  };
}

/** Asks through a port, and hears each answer: its header, then its parts, as they came with it or pulled one at a time. */
export class Asker {
  #next = 0;
  #waiting = new Map<number, { resolve(answer: Answer): void; reject(error: unknown): void }>();
  #closed = false;

  constructor(private port: MessagePort) {
    port.onmessage = ({ data }: MessageEvent<Answer>) => {
      const waiting = this.#waiting.get(data.id);
      this.#waiting.delete(data.id);
      if ('error' in data) waiting?.reject(new SolverError(data.error.code, data.error.message)); else waiting?.resolve(data);
    };
  }

  #hear(id: number, signal?: AbortSignal): Promise<Answer> {
    if (this.#closed) return Promise.reject(new DOMException('The reader closed.', 'AbortError'));
    return new Promise((resolve, reject) => {
      const abort = () => { this.#waiting.delete(id); this.port.postMessage({ id, op: 'abort' } satisfies Ask); reject(signal!.reason); };
      this.#waiting.set(id, {
        resolve: answer => { signal?.removeEventListener('abort', abort); resolve(answer); },
        reject: error => { signal?.removeEventListener('abort', abort); reject(error); },
      });
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  /** Asks `question`; its header resolves, and its parts follow as they are read. Leaving them early releases the rest. */
  async ask<H>(question: Questioning, signal?: AbortSignal): Promise<{ readonly header: H; readonly parts: AsyncGenerator<ArrayBuffer> }> {
    signal?.throwIfAborted();
    const id = this.#next++, heard = this.#hear(id, signal);
    this.port.postMessage({ ...question, id } satisfies Ask);
    const answer = await heard as Extract<Answer, { header: unknown }>, asker = this;
    return { header: answer.header as H, parts: (async function* () {
      yield* answer.parts;
      if (!answer.more) return;
      let ended = false;
      try {
        for (;;) {
          const next = asker.#hear(id, signal);
          asker.port.postMessage({ id, op: 'next' } satisfies Ask);
          const heard = await next;
          if ('end' in heard) { ended = true; return; }
          yield (heard as Extract<Answer, { part: ArrayBuffer }>).part;
        }
      } finally { if (!ended && !asker.#closed) asker.port.postMessage({ id, op: 'abort' } satisfies Ask); }
    })() };
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.port.postMessage({ op: 'close' } satisfies Ask);
    this.port.close();
    for (const waiting of this.#waiting.values()) waiting.reject(new DOMException('The reader closed.', 'AbortError'));
    this.#waiting.clear();
  }
}
