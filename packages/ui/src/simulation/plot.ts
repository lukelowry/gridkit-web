import type { Tiles } from 'latkit';
import type { Quantity } from './channels.js';
import type { Basis } from '../domain/measure.js';
import type { TimeRange } from '@gridkit/solver';

/** The dataset the plot's traces draw: table `Trace`, a row per series. */
export const plotDataset = 'simulation-plot';

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

/** What the plot draws, independent of execution and transport. */
export interface PlotData {
  /** The quantity's time tiles: latkit fetches the detail the plot window shows. */
  readonly source: Tiles;
  readonly quantity: Quantity;
  /** What the traces show of it. */
  readonly basis: Basis;
  /** The time they deviate from, or the first sample without one. */
  readonly reference: number | null;
  readonly camera: PlotCamera;
}
