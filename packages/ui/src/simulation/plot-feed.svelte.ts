import { Data } from 'latkit';
import type { TimeRange } from '@gridkit/solver';
import type { Quantity } from './channels.js';
import type { Basis } from '../domain/measure.js';
import { PlotBuffer, type PlotData, type PlotViewport } from './plot.js';
import { Feed, type RunResults } from './results.js';

const packetBytes = 2 * 1024 * 1024;
const sameRange = (a: TimeRange | null, b: TimeRange | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);

export interface PlotFeedOptions {
  /** The run's results, which its session owns. */
  results: RunResults;
  /** The submitted duration, which the plot shows until zoomed. */
  timeline: TimeRange;
  extend(range: TimeRange): void;
  failed(cause: unknown): void;
}

/**
 * What the plot draws: a quantity at the resolution of its pixels, and the camera over it. latkit fits the values in view unless
 * a vertical gesture pinned them; only Fit and a new measure command the camera.
 */
export class PlotFeed {
  plot = $state.raw<PlotData>();
  #data = new Data('simulation-plot').axis('Time', 's');
  #feed = new Feed();
  #shown: { readonly quantity: Quantity; readonly basis: Basis; readonly reference: number | null } | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #viewport: PlotViewport | null = null;
  #pixels = 800;
  #camera = 0;

  constructor(private options: PlotFeedOptions) {}

  /** Plots `quantity` as `basis` from `reference`: its values fit anew, and the times shown stay. */
  show(quantity: Quantity, basis: Basis, reference: number | null) {
    this.#shown = { quantity, basis, reference };
    if (this.#viewport) this.#viewport = { ...this.#viewport, y: null };
    this.#subscribe();
  }
  #subscribe() {
    clearTimeout(this.#timer);
    const shown = this.#shown;
    if (!shown) return;
    const { quantity, basis, reference } = shown, data = this.#data, { results, timeline, extend, failed } = this.options;
    const feed = { kind: 'plot' as const, columns: quantity.channels.map(channel => channel.column), basis, reference,
      range: this.#viewport?.x ?? timeline, resolution: Math.max(32, Math.min(65536, Math.ceil(this.#pixels))), maxBytes: packetBytes };
    this.#feed.start(async signal => {
      const buffer = new PlotBuffer(data);
      try {
        await results.follow(feed, signal, async page => {
          await buffer.ready(signal);
          if (!buffer.apply(page) || !page.range) return;
          extend(page.range);
          // A new measure replaces the one drawn whole, once its first update is complete; later updates only add samples.
          const drawn = this.plot;
          if (drawn?.quantity === quantity && drawn.basis === basis && drawn.reference === reference) return;
          const camera = { version: ++this.#camera, x: this.#viewport?.x ?? timeline, y: this.#viewport?.y ?? null };
          this.plot = { data, quantity, basis, reference, camera };
        });
      } finally { buffer.destroy(); }
    }, failed);
  }
  viewport(viewport: PlotViewport, pixels: number, manual = false) {
    const resized = Math.abs(pixels - this.#pixels) > 1;
    this.#pixels = Math.max(1, pixels);
    if (!manual) { if (resized) this.#schedule(); return; }
    const movedX = !sameRange(viewport.x, this.#viewport?.x ?? this.options.timeline);
    this.#viewport = { x: [...viewport.x], y: viewport.y ? [...viewport.y] : null };
    // Remember the actual camera for remounts without echoing a new command.
    if (this.plot) this.plot = { ...this.plot, camera: { ...this.#viewport, version: this.plot.camera.version } };
    // A vertical gesture changes no requested samples.
    if (movedX || resized) this.#schedule();
  }
  #schedule() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#subscribe(), 100);
  }
  fit() {
    if (!this.plot) return;
    this.#viewport = null;
    this.plot = { ...this.plot, camera: { version: ++this.#camera, x: this.options.timeline, y: null } };
    this.#subscribe();
  }
  close() {
    clearTimeout(this.#timer);
    this.#feed.stop();
    this.#data.destroy();
  }
}
