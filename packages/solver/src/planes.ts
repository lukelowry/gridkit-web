import type { Envelope, Samples } from './index.js';

// Replies' numbers as views of the buffers they arrive in: read where they lie, never copied out.

/** Rows' planes as samples: their times, then their time-major values. */
export function samplesOf(buffer: ArrayBuffer, first: number, count: number, columns: readonly string[]): Samples {
  return { kind: 'samples', first, columns, times: new Float64Array(buffer, 0, count), values: new Float64Array(buffer, 8 * count, count * columns.length) };
}
/** Coarse entries' planes as an envelope: starts, ends, minima, then maxima. */
export function envelopeOf(buffer: ArrayBuffer, count: number, columns: readonly string[]): Envelope {
  const width = count * columns.length;
  return { kind: 'envelope', columns, starts: new Float64Array(buffer, 0, count), ends: new Float64Array(buffer, 8 * count, count),
    minimum: new Float64Array(buffer, 16 * count, width), maximum: new Float64Array(buffer, 16 * count + 8 * width, width) };
}
