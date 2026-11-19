import { elementCatalog } from '../catalog.js';
import type { ElementRecord } from '../document.js';
import type { ElementTarget } from '../fields.js';

/** An output of the elements `target` names that a view reads: a run records it beside what it always records. */
export interface WantedOutput extends ElementTarget { readonly output: string }

/** What a run can record of `row`: every output of its model. */
export const recordableOutputs = (row: ElementRecord) => elementCatalog.get(String(row.value.class))?.model.outputs ?? [];

/** What a run records of `row`: a bus's voltage, a device's speed and whatever its case monitors, and what `wanted` reads of it. */
export function recordedOutputs(row: ElementRecord, wanted: readonly WantedOutput[]) {
  const requested = row.ref.collection === 'buses' ? ['Vm', 'Va'] : [...Array.isArray(row.value.mon) ? row.value.mon : [], 'omega'];
  for (const want of wanted)
    if (want.collection === row.ref.collection && (!want.class || want.class === String(row.value.class))) requested.push(want.output);
  return recordableOutputs(row).filter(output => requested.some(name => String(name).toLowerCase() === output.id.toLowerCase()));
}
