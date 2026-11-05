// Only types: the results worker reads this, and carries neither zod nor the manifest.
import type { ColormapName } from 'latkit';

/** What a measure shows of an output: as recorded, its difference from the run's reference, or that difference in percent of it. */
export type Basis = 'value' | 'change' | 'percent';
export interface Measure { readonly output: string; readonly basis: Basis }
/**
 * `(value - offset) * scale`, with `scale` above 0: a summary's minimum and maximum keep their order, so every basis passes
 * through latkit's levels of detail without reading the samples again. The plot applies it in full precision, before the
 * renderer's Float32, so a small change on a large value keeps its detail. The network reads the same measure as a latkit
 * expression of what it recorded (`sampledExpression`), in Float32: finer than a color or height shows of the per-unit and
 * radian outputs GridKit records.
 */
export interface Affine { readonly offset: number; readonly scale: number }

/** A measure's sampled field: `Vm`, `Vm~change`, or `Vm~percent`. GridKit's output ids never hold a `~`. */
export const fieldOf = ({ output, basis }: Measure) => basis === 'value' ? output : `${output}~${basis}`;
/** The field beside an output that holds each element's value at the reference its deviations are measured from: `Vm~from`. */
export const referenceField = (output: string) => `${output}~from`;
export function measureOf(field: string): Measure {
  const [output, basis = 'value'] = field.split('~');
  return { output: output!, basis: basis as Basis };
}
/** A zero reference has no percent. */
export function affine(basis: Basis, reference: number): Affine {
  if (basis === 'value') return { offset: 0, scale: 1 };
  if (basis === 'change') return { offset: reference, scale: 1 };
  return reference ? { offset: reference, scale: 100 / Math.abs(reference) } : { offset: NaN, scale: 1 };
}
/** An angle has no base to be a percent of. */
export const percentable = (unit: string | undefined) => unit !== 'rad';
export const measureUnit = (unit: string | undefined, basis: Basis) => basis === 'percent' ? '%' : unit ?? '';

/**
 * How an output reads on the network: as recorded through `map` over `domain`, standing as high as it lies in `height`, and as a
 * deviation across a symmetric `band`, so no change is always the middle of a diverging map.
 */
export const readings: Readonly<Record<string, { map: ColormapName; domain: [number, number]; height: [number, number]; band: Partial<Record<Basis, number>> }>> = {
  Vm: { map: 'rdbu', domain: [0.8, 1.2], height: [0, 1.3], band: { change: 0.1, percent: 10 } },
  Va: { map: 'twilight', domain: [-Math.PI, Math.PI], height: [-Math.PI, Math.PI], band: { change: 0.5 } },
};
export const defaultBand = ({ output, basis }: Measure) => readings[output]?.band[basis] ?? (basis === 'percent' ? 5 : 1);
