import { Data, type Snapshot } from 'latkit';
import type { Quantity } from './channels.js';
import type { Basis } from '../domain/measure.js';
import type { PlotPage } from './results.worker.js';
import type { TimeRange } from '@gridkit/solver';

export interface PlotViewport {
  readonly x: TimeRange;
  /** Null requests automatic value bounds. */
  readonly y: TimeRange | null;
}

/** Where the plot draws its time axis, so controls can line up with it: CSS pixels from the plot's left, and the times shown. */
export interface PlotAxis {
  readonly left: number;
  readonly width: number;
  readonly from: number;
  readonly to: number;
}

/** Last known viewport, independent of the rows recorded and playback. */
export interface PlotCamera extends PlotViewport {
  /** Increment only to command the view, including repeated Fit requests. */
  readonly version: number;
}

/** The plot's data, owned by the caller, independent of execution and transport. */
export interface PlotData {
  /** The Data identity stays stable as the run grows; it owns the view's lifetime. */
  readonly data: Data;
  readonly quantity: Quantity;
  /** What the traces show of it. */
  readonly basis: Basis;
  /** The time they deviate from, or the first sample without one. */
  readonly reference: number | null;
  readonly camera: PlotCamera;
}

/**
 * Keeps applying data from taking a frame's time: credit stays withheld while yielding, so at most one transferable page waits on
 * the UI. A hidden tab does no such work, and cancellation always wakes it.
 */
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

/** Builds one update off-screen, sharing immutable history pages, while the published Data keeps its identity. History and
 * edge runs belong to the same sampled field, so latkit connects adjacent absolute sample indices across every seam. */
export class PlotBuffer {
  #building = new Data('simulation-plot');
  #sealed: Snapshot | undefined;
  #next: Snapshot | undefined;
  #open = false;
  #sealing = false;
  #pace = new Pace();
  constructor(private data: Data) {}

  apply(page: PlotPage): boolean {
    this.#pace.spend(() => this.#apply(page));
    return page.complete;
  }
  #apply(page: PlotPage) {
    if (page.begin) {
      if (this.#open) throw new Error('Unfinished trace update.');
      if (!page.reset && !this.#sealed) throw new Error('Missing sealed trace history.');
      if (!page.reset) this.#building.restore(this.#sealed!);
      this.#open = true; this.#sealing = false;
    } else if (!this.#open || page.reset) throw new Error('Unexpected trace page.');
    this.#building.apply(page.history);
    if (page.seal) {
      if (this.#sealing) throw new Error('Trace history was sealed twice.');
      this.#next = this.#building.snapshot();
      this.#sealing = true;
    }
    this.#building.apply(page.edges);
    if (page.complete) {
      if (!this.#next || !this.#sealing) throw new Error('Incomplete trace history.');
      const snapshot = this.#building.snapshot();
      try { this.data.restore(snapshot); } finally { snapshot.destroy(); }
      this.#sealed?.destroy(); this.#sealed = this.#next; this.#next = undefined;
      this.#open = false;
    }
  }
  ready(signal: AbortSignal) { return this.#pace.ready(signal); }

  destroy() {
    this.#next?.destroy(); this.#sealed?.destroy(); this.#building.destroy();
  }
}
