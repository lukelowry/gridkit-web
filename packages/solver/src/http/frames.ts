import { SolverError, type EntriesQuery, type RowsQuery } from '../index.js';
import type { PlanesHeader, Reply } from '../protocol.js';

// The service's replies: a length-prefixed JSON header, then its planes. Each is refused before it is held if it is more than was
// asked for.

const invalid = () => new SolverError('protocol', 'Invalid solver reply.');

/** A reply's bytes, however the transport fragments them. */
class Body {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #chunk: Uint8Array = new Uint8Array();
  #offset = 0;
  #closed = false;
  constructor(stream: ReadableStream<Uint8Array> | null) {
    if (!stream) throw invalid();
    this.#reader = stream.getReader();
  }
  /** The next `size` bytes, gathered into a buffer of their own that the numbers are read from in place. */
  async take(size: number): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(size);
    for (let filled = 0; filled < size;) {
      if (this.#offset === this.#chunk.length) {
        const next = await this.#reader.read();
        if (next.done) throw invalid();
        this.#chunk = next.value; this.#offset = 0;
      }
      const count = Math.min(size - filled, this.#chunk.length - this.#offset);
      bytes.set(this.#chunk.subarray(this.#offset, this.#offset + count), filled);
      this.#offset += count; filled += count;
    }
    return bytes.buffer;
  }
  async header<T>(): Promise<T> {
    const size = new DataView(await this.take(4)).getUint32(0, true);
    if (!size || size > 16 * 1024 * 1024) throw invalid();
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.take(size))) as T; }
    catch (cause) { throw (cause as { name?: string }).name === 'AbortError' ? cause : invalid(); }
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#reader.cancel().catch(() => {});
    this.#reader.releaseLock();
  }
}

/** Rows, or entries of a level: their header, then one part, their planes. */
export async function planesReply(response: Response, query: RowsQuery | EntriesQuery): Promise<Reply<PlanesHeader>> {
  const body = new Body(response.body);
  try {
    const header = await body.header<PlanesHeader>(), planes = 'level' in query && query.level ? 2 : 1;
    const size = 8 * planes * header.count * (1 + query.columns.length);
    if (size > query.maxBytes) throw invalid();
    return { header, parts: [await body.take(size)] };
  } finally { await body.close(); }
}
