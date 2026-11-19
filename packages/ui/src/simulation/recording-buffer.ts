import { Data } from 'latkit';
import type { NetworkPage } from './results.worker.js';

/** Assemble bounded byte fragments and publish a complete set of sample columns together. */
export class RecordingBuffer {
  #building: Data;
  #bytes: Uint8Array | undefined;
  #offset = 0;
  #open = false;

  constructor(private data: Data) { this.#building = new Data(data.name).axis('Time', 's'); }

  apply(page: NetworkPage): boolean {
    if (page.begin) {
      if (this.#open) throw new Error('Unfinished network update.');
      if (!page.reset) {
        const snapshot = this.data.snapshot();
        try { this.#building.restore(snapshot); } finally { snapshot.destroy(); }
      }
      this.#open = true;
    }
    if (!this.#open || page.offset !== this.#offset) throw new Error('Unexpected network fragment.');
    if (!this.#bytes) this.#bytes = new Uint8Array(page.length);
    if (page.length !== this.#bytes.length) throw new Error('Network fragment length changed.');
    this.#bytes.set(page.bytes, this.#offset);
    this.#offset += page.bytes.length;
    if (this.#offset === this.#bytes.length) {
      this.#building.apply(this.#bytes);
      this.#bytes = undefined; this.#offset = 0;
    }
    if (page.complete) {
      if (this.#bytes) throw new Error('Incomplete network patch.');
      const snapshot = this.#building.snapshot();
      try { this.data.restore(snapshot); } finally { snapshot.destroy(); }
      this.#open = false;
    }
    return page.complete;
  }

  destroy() { this.#bytes = undefined; this.#building.destroy(); }
}
