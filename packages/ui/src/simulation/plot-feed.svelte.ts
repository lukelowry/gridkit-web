import type { TimeRange } from '@gridkit/solver';
import type { Quantity } from './channels.js';
import type { Basis } from '../domain/measure.js';
import type { PlotData, PlotViewport } from './plot.js';
import type { RunResults } from './results.js';
import type { TileSet } from './results.worker.js';

export interface PlotFeedOptions {
  /** The run's results, which its session owns. */
  results: RunResults;
  /** The submitted duration, which the plot shows until zoomed. */
  timeline: TimeRange;
}

const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]));

/**
 * What the plot draws: a quantity's time tiles, and the camera over them. latkit fetches the detail the plot window shows, and fits
 * the values in view unless a vertical gesture pinned them; only Fit and a new measure command the camera. A gesture's camera is
 * remembered for a plot drawn again, and changes nothing drawn.
 */
export class PlotFeed {
  plot = $state.raw<PlotData>();
  #set: TileSet | undefined;
  #viewport: PlotViewport | null = null;
  #camera = 0;

  constructor(private options: PlotFeedOptions) {}

  /** Where a plot drawn again opens: where gestures last left its camera, else where it was last told to be. */
  get opening(): PlotViewport { return this.#viewport ?? this.plot?.camera ?? { x: this.options.timeline, y: null }; }

  /**
   * Plots `quantity` as `basis` from `reference`, each series in the color `series` gives it, or by its place: its values fit anew,
   * and the times shown stay.
   */
  show(quantity: Quantity, basis: Basis, reference: number | null, series?: readonly number[]) {
    const columns = quantity.channels.map(channel => channel.column), shown = this.#set;
    if (this.plot && shown && shown.basis === basis && shown.reference === reference && same(shown.series, series) && same(shown.columns, columns)) return;
    const set: TileSet = { columns, ...series && { series }, basis, reference }, source = this.options.results.tiles(set);
    this.#set = set;
    if (this.#viewport) this.#viewport = { ...this.#viewport, y: null };
    const camera = { version: ++this.#camera, x: this.#viewport?.x ?? this.options.timeline, y: null };
    this.plot = { source, quantity, basis, reference, camera };
  }
  clear() { this.plot = undefined; this.#set = undefined; }
  /** Remembers where a gesture left the camera: it commands nothing, and what is shown is fetched without asking. */
  viewport(viewport: PlotViewport) { this.#viewport = { x: [...viewport.x], y: viewport.y ? [...viewport.y] : null }; }
  fit() {
    if (!this.plot) return;
    this.#viewport = null;
    this.plot = { ...this.plot, camera: { version: ++this.#camera, x: this.options.timeline, y: null } };
  }
}
