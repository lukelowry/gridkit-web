import { isTerminal, type Artifact, type Run, type Solver, type TimeRange } from '@gridkit/solver';
import type { CaseDocument } from '@gridkit/library';
import { percentable, type Basis, type Measure } from '../domain/measure.js';
import { errorMessage } from '../ui/errors.js';
import { latkit } from '../ui/latkit.js';
import { quantitiesOf, type Quantity } from './channels.js';
import { BranchState } from './branches.js';
import { compile, switchable, type Channel, type SimulationEvent, type Study } from '@gridkit/library/gridkit';
import type { SampledField } from './sampled.js';
import { PlotFeed } from './plot-feed.svelte.js';
import type { PlotViewport } from './plot.js';
import { Playhead } from './playhead.svelte.js';
import { Recording } from './recording.svelte.js';
import { Feed, RunResults } from './results.js';

/** What one run's viewer carries into the next, so runs compare as they replace each other. */
export interface RunPreferences { readonly basis: Basis; readonly band: number | null; readonly speed: number }

/**
 * One submitted run and everything shown of it: created as it starts and thrown away whole, so a late callback can only reach
 * an object nothing shows any more. It wires what owns each part: the `playhead` the time, the recording what the network draws,
 * the plot feed what the plot draws.
 */
export class RunSession {
  /** The case's content version it ran; its results stop applying once the case changes. */
  readonly caseVersion: number;
  /** Submitted duration, independent of available results and editable settings. */
  readonly timeline: TimeRange;
  /** The submitted events, as the scrubber marks them. */
  readonly events: readonly SimulationEvent[];
  readonly playhead: Playhead;
  status = $state('Preparing');
  error = $state('');
  busy = $state(true);
  quantities = $state.raw<Quantity[]>([]);
  channels = $state.raw<readonly Channel[]>([]);
  /** What the run offers to download, once it has ended. */
  artifacts = $state.raw<readonly Artifact[]>([]);
  range = $state.raw<TimeRange>([0, 0]);
  /** Whether the time shown follows the run as it records. */
  live = $state(true);
  /** The quantity the plot shows; a bus quantity is the one the network reads too. */
  quantity = $state.raw<Quantity>();
  /** What the plot and the network show of it. */
  basis = $state<Basis>('value');
  /** The time deviations are measured from, or the first sample without one. */
  reference = $state<number | null>(null);
  /** How far from no change a deviation's colors reach, or the output's own band without one. */
  band = $state<number | null>(null);
  #recording = $state.raw<Recording>();
  #plotFeed = $state.raw<PlotFeed>();
  #busQuantity = $state.raw<Quantity>();
  /** What the network shows by default: the last bus quantity plotted. An angle has no percent. */
  readonly networkMeasure = $derived.by<Measure>(() => {
    const quantity = this.#busQuantity;
    return { output: quantity?.output ?? 'Vm', basis: this.basis === 'percent' && !percentable(quantity?.unit) ? 'change' : this.basis };
  });
  /** Whether the run recorded any samples. */
  get recorded() { return this.range[1] > this.range[0]; }
  /** Whether the run itself failed, as opposed to reading its results. */
  get failed() { return this.status === 'Failed' || this.status === 'Unavailable'; }
  get playing() { return (this.live && this.busy) || this.playhead.playing; }
  /** The samples the network draws, once latkit has loaded; the session owns them. */
  get data() { return this.#recording?.data; }
  get sampledFields(): readonly SampledField[] { return this.#recording?.fields ?? []; }
  get plot() { return this.#plotFeed?.plot; }
  #execution: Run | undefined;
  #results: RunResults | undefined;
  #branches: BranchState | undefined;
  #observer = new Feed();

  constructor(client: Solver, document: CaseDocument, version: number, study: Study, carried: RunPreferences) {
    // Compiled now, so later edits never change what runs; a case GridKit cannot take fails the run, not the click that asked for it.
    const compiled = (async () => compile(document, study))();
    const { tmax, events = [], dt_monitor } = structuredClone(study);
    const branches = new Map(document.rows('devices').filter(switchable).map(row => [String(row.value.id), row.ref.id]));
    this.caseVersion = version;
    this.timeline = [0, tmax];
    this.events = events;
    this.basis = carried.basis; this.band = carried.band;
    this.playhead = new Playhead({ moved: time => this.#branches?.seek(time), end: () => this.range[1], running: () => this.busy });
    this.playhead.speed = carried.speed;
    this.#observer.start(async signal => {
      await latkit();
      signal.throwIfAborted();
      const { channels, ...request } = await compiled;
      signal.throwIfAborted();
      const run = this.#execution = client.start(request), results = this.#results = new RunResults(run.results());
      const parts = { results, extend: (range: TimeRange) => this.#extend(range), failed: (cause: unknown) => { this.error = errorMessage(cause); } };
      const recording = this.#recording = new Recording({ ...parts, rows: Math.ceil(tmax / dt_monitor) + 1 + 2 * events.length });
      const plotFeed = this.#plotFeed = new PlotFeed({ ...parts, timeline: this.timeline });
      this.#branches = new BranchState(recording.data, branches, events);
      void run.artifacts.then(artifacts => { this.artifacts = artifacts; }, () => {});
      for await (const update of run.updates(signal)) {
        signal.throwIfAborted();
        this.status = ({ preparing: 'Preparing', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' })[update.state];
        this.busy = !isTerminal(update.state);
        if (update.state === 'failed') this.error = update.error.message;
        if (!update.progress) continue;
        this.#extend(update.progress.range);
        if (this.channels.length) continue;
        this.channels = channels;
        this.quantities = quantitiesOf(this.channels);
        const voltage = this.quantities.find(quantity => quantity.output === 'Vm' && quantity.channels[0]?.element.collection === 'buses');
        this.quantity = voltage ?? this.quantities[0];
        this.#busQuantity = voltage;
        recording.start(this.channels, this.reference);
        if (this.quantity) plotFeed.show(this.quantity, this.basis, this.reference);
      }
    }, cause => { this.error = errorMessage(cause); this.status = 'Unavailable'; this.busy = false; this.playhead.pause(); });
  }

  #extend(range: TimeRange) {
    this.range = [range[0], Math.max(this.range[1], range[1])];
    if (this.live) this.playhead.show(this.range[1]);
  }

  /** Installs the sampled fields the network's scene reads. */
  sample(fields: readonly SampledField[]) { this.#recording?.want(fields); }

  /** Plots `key`'s quantity; a bus quantity also becomes what the network shows. */
  select(key: string) {
    const quantity = this.quantities.find(quantity => quantity.key === key);
    if (!quantity || quantity === this.quantity) return;
    this.quantity = quantity;
    if (quantity.channels[0]?.element.collection === 'buses') this.#busQuantity = quantity;
    if (this.basis === 'percent' && !percentable(quantity.unit)) this.basis = 'change';
    this.band = null;
    this.#plotFeed?.show(quantity, this.basis, this.reference);
  }

  /**
   * Shows `basis` from `reference`, in the plot and the network; the values refit, the times stay. The network reads either from
   * what it recorded: a new basis through what its scene then reads, a new reference as each element's value there.
   */
  measure(basis = this.basis, reference = this.reference) {
    const moved = reference !== this.reference;
    if (basis === this.basis && !moved) return;
    if (basis !== this.basis) this.band = null;
    this.basis = basis; this.reference = reference;
    if (moved) this.#recording?.measureFrom(reference);
    if (this.quantity) this.#plotFeed?.show(this.quantity, basis, reference);
  }

  viewport(viewport: PlotViewport, pixels: number, manual = false) { this.#plotFeed?.viewport(viewport, pixels, manual); }
  fit() { this.#plotFeed?.fit(); }

  /** Follows the run as it records. */
  follow() {
    this.live = true;
    this.playhead.pause();
    this.playhead.show(this.range[1]);
  }

  seek(time: number) {
    if (!Number.isFinite(time)) return;
    this.live = false;
    this.playhead.pause();
    this.playhead.show(Math.max(this.range[0], Math.min(this.range[1], time)));
  }

  play(playing: boolean) {
    this.live = false;
    if (!playing) { this.playhead.pause(); return; }
    if (this.playhead.time >= this.range[1]) this.playhead.show(this.range[0]);
    this.playhead.play();
  }

  async cancel() { try { await this.#execution?.cancel(); } catch (cause) { this.error = errorMessage(cause); } }

  /** Stops everything the session runs and releases what it holds, cancelling a run still going. */
  close() {
    this.#observer.stop();
    this.playhead.pause();
    if (this.busy) void this.#execution?.cancel().catch(() => {});
    this.busy = false;
    this.#recording?.close();
    this.#plotFeed?.close();
    this.#results?.close();
  }

  /** Asks the solver to stop, and waits for its answer. */
  async stop() { if (this.busy) await this.#execution?.cancel(); }
}
