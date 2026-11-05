import type { Data } from 'latkit';
import type { SimulationEvent } from '@gridkit/library/gridkit';

export const branchStateTable = 'BranchState';

/** Switching state from the submitted study, keyed by the case snapshot's element IDs. */
export class BranchState {
  #events: { time: number; id: string; before: number; after: number }[] = [];
  #values: Map<string, number>;
  #cursor = 0;

  constructor(private readonly data: Data, branches: ReadonlyMap<string, string>, events: readonly SimulationEvent[] = []) {
    const ids = [...branches.values()];
    this.#values = new Map(ids.map(id => [id, 1]));
    const values = new Map(this.#values);
    // Stable ordering also preserves the submitted order of simultaneous events.
    for (const event of [...events].sort((a, b) => a.time - b.time)) {
      if (!('device' in event)) continue;
      const id = branches.get(event.device);
      if (id === undefined) continue;
      const before = values.get(id)!, after = Number(event.type === 'in_service');
      this.#events.push({ time: event.time, id, before, after });
      values.set(id, after);
    }
    data.replace(branchStateTable, ids, { inService: ids.map(() => 1) });
    this.seek(0);
  }

  /** Only crossed events are visited; only changed rows are uploaded, even on a long seek. */
  seek(time: number) {
    const changes = new Map<string, number>();
    while (this.#cursor < this.#events.length && this.#events[this.#cursor]!.time <= time) {
      const event = this.#events[this.#cursor++]!;
      changes.set(event.id, event.after);
    }
    while (this.#cursor > 0 && this.#events[this.#cursor - 1]!.time > time) {
      const event = this.#events[--this.#cursor]!;
      changes.set(event.id, event.before);
    }
    const ids: string[] = [], inService: number[] = [];
    for (const [id, value] of changes) if (this.#values.get(id) !== value) {
      ids.push(id); inService.push(value); this.#values.set(id, value);
    }
    if (ids.length) this.data.set(branchStateTable, ids, { inService });
  }
}
