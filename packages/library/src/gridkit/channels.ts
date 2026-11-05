import { elementCatalog } from '../catalog.js';
import type { ElementRecord } from '../document.js';

/** What a run records of `row`: a bus's voltage, a device's speed and whatever its case monitors. */
export function recordedOutputs(row: ElementRecord) {
  const requested = row.ref.collection === 'buses' ? ['Vm', 'Va'] : [...Array.isArray(row.value.mon) ? row.value.mon : [], 'omega'];
  return (elementCatalog.get(String(row.value.class))?.model.outputs ?? [])
    .filter(output => requested.some(name => String(name).toLowerCase() === output.id.toLowerCase()));
}
