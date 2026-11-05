import type { Channel } from '@gridkit/library/gridkit';
import { Data, field, type Fields } from 'latkit';
import type { TimeRange } from '@gridkit/solver';
import { measureOf, referenceField } from '../domain/measure.js';
import { matchesField, simulationDataset, type SampledField } from './sampled.js';
import { Pace } from './plot.js';
import { Feed, type RunResults } from './results.js';

const packetBytes = 2 * 1024 * 1024;
/** What the network holds of a run, in values drawn; a run past this keeps every Nth row. */
const heldBytes = 256 * 1024 * 1024;
const fieldKey = ({ collection, class: type, field }: SampledField) => JSON.stringify([collection, type ?? null, field]);

export interface RecordingOptions {
  /** The run's results, which its session owns. */
  results: RunResults;
  /** About how many rows the run will record. */
  rows: number;
  extend(range: TimeRange): void;
  failed(cause: unknown): void;
}

/**
 * Everything the network draws of a run: each output it reads, kept whole as it arrives, and beside each the value every element
 * measures deviations from. Showing any time, basis, or reference never asks the solver.
 */
export class Recording {
  readonly data = new Data(simulationDataset).axis('Time', 's');
  /** The outputs installed so far, each once its samples arrive: every measure of one reads it. */
  fields = $state.raw<readonly SampledField[]>([]);
  #wanted: readonly SampledField[] = [{ collection: 'buses', field: 'Vm' }];
  #channels: readonly Channel[] = [];
  #reference: number | null = null;
  /** The time the installed references were read at. */
  #referred: number | undefined;
  #feed = new Feed();

  constructor(private options: RecordingOptions) {}

  /** Starts on `channels`, the run's outputs, once it has recorded some. */
  start(channels: readonly Channel[], reference: number | null) {
    this.#channels = channels;
    this.#reference = reference;
    this.#bind();
  }
  /** Installs the outputs the network's scene reads; each of their measures shares the one recording. */
  want(fields: readonly SampledField[]) {
    const outputs = new Map(fields.map(sampled => ({ ...sampled, field: measureOf(sampled.field).output })).map(output => [fieldKey(output), output]));
    const keys = [...outputs.keys()].sort();
    if (JSON.stringify(keys) === JSON.stringify(this.#wanted.map(fieldKey).sort())) return;
    this.#wanted = keys.map(key => outputs.get(key)!);
    if (this.#channels.length) this.#bind();
  }
  /** Measures deviations from `reference`, or the first sample without one: the samples stay, and only each reference changes. */
  measureFrom(reference: number | null) {
    this.#reference = reference;
    this.#referred = undefined;
    this.#refer();
  }
  /** Writes each element's value at the reference beside its output, once the frames installed reach it. */
  #refer(outputs = this.fields) {
    const span = this.data.describe().span, at = this.#reference ?? span?.[0];
    if (!span || at === undefined || at > span[1] || at === this.#referred) return;
    const tables = new Map<string, Set<string>>();
    for (const { collection, field: output } of outputs) tables.set(collection, (tables.get(collection) ?? new Set()).add(output));
    for (const [table, names] of tables) {
      const select = Object.fromEntries([...names].map(output => [referenceField(output), field(output)]));
      const read = this.data.query({ of: table, at, select });
      this.data.set(table, read.ids, read.fields as Fields);
    }
    this.#referred = at;
  }
  #bind() {
    this.#feed.stop();
    this.#referred = undefined;
    const wanted = this.#wanted, channels = this.#channels.filter(channel => wanted.some(sampled => matchesField(channel, sampled)));
    if (!channels.length) return;
    const installed = [...new Map(channels.map(channel => {
      const output = { collection: channel.element.collection, ...channel.class ? { class: channel.class } : {}, field: channel.output };
      return [fieldKey(output), output];
    })).values()];
    const { results, extend, failed } = this.options, pace = new Pace();
    const every = Math.max(1, Math.ceil(this.options.rows * channels.length * 4 / heldBytes));
    const feed = { kind: 'network' as const, channels, every, maxBytes: packetBytes };
    this.#feed.start(signal => results.follow(feed, signal, async page => {
      await pace.ready(signal);
      pace.spend(() => { this.data.apply(page.bytes); this.#refer(installed); });
      this.fields = installed;
      if (page.range) extend(page.range);
    }), failed);
  }
  close() {
    this.#feed.stop();
    this.data.destroy();
  }
}
