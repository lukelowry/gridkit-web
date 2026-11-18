import type { TimeRange } from '@gridkit/solver';
import type { Quantity } from './channels.js';
import type { Basis } from '../domain/measure.js';
import type { PlotData, PlotViewport } from './plot.js';
import type { RunResults } from './results.js';

export interface PlotFeedOptions {
  /** The run's results, which its session owns. */
  results: RunResults;
  /** The submitted duration, which the plot shows until zoomed. */
  timeline: TimeRange;
}

/**
 * What the plot draws: a quantity's time tiles, and the camera over them. latkit fetches the detail the plot window shows, and fits
 * the values in view unless a vertical gesture pinned them; only Fit and a new measure command the camera.
 */
export class PlotFeed {
  plot = $state.raw<PlotData>();
  #viewport: PlotViewport | null = null;
  #camera = 0;

  constructor(private options: PlotFeedOptions) {}

  /** Plots `quantity` as `basis` from `reference`: its values fit anew, and the times shown stay. */
  show(quantity: Quantity, basis: Basis, reference: number | null) {
    const shown = this.plot;
    if (shown?.quantity === quantity && shown.basis === basis && shown.reference === reference) return;
    const source = this.options.results.tiles({ columns: quantity.channels.map(channel => channel.column), basis, reference });
    if (this.#viewport) this.#viewport = { ...this.#viewport, y: null };
    const camera = { version: ++this.#camera, x: this.#viewport?.x ?? this.options.timeline, y: null };
    this.plot = { source, quantity, basis, reference, camera };
  }
  clear() { this.plot = undefined; }
  /** Remembers the camera a gesture placed, so a plot drawn again shows it; what it shows is fetched without asking. */
  viewport(viewport: PlotViewport) {
    this.#viewport = { x: [...viewport.x], y: viewport.y ? [...viewport.y] : null };
    if (this.plot) this.plot = { ...this.plot, camera: { ...this.#viewport, version: this.plot.camera.version } };
  }
  fit() {
    if (!this.plot) return;
    this.#viewport = null;
    this.plot = { ...this.plot, camera: { version: ++this.#camera, x: this.options.timeline, y: null } };
  }
}
