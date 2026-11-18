import { isTerminal, type Artifact, type Run, type Solver, type TimeRange } from '@gridkit/solver';
import type { CaseDocument, ElementRef } from '@gridkit/library';
import { Data, type LatkitError, type Source } from 'latkit';
import { percentable, type Basis, type Measure } from '../domain/measure.js';
import { errorMessage } from '../ui/errors.js';
import { latkit } from '../ui/latkit.js';
import { channelsOf, pinnedSeriesLimit, quantitiesOf, type Quantity } from './channels.js';
import { sameReference } from '../domain/entries.js';
import { BranchState, branchStateDataset } from './branches.js';
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
  /** A failed run offers retry; result-reading errors preserve the completed run. */
  failed = $state(false);
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
  /** Whether the plot draws every series of its quantity, or only the selected and pinned elements'. */
  plotMode = $state<'all' | 'focused'>('all');
  pinned = $state.raw<readonly (ElementRef & { readonly label: string })[]>([]);
  #selected: ElementRef | null = null;
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
  /** Whether the time shown is moving with a run still recording. */
  get following() { return this.live && this.busy; }
  get playing() { return this.following || this.playhead.playing; }
  /** The samples the network draws, once latkit has loaded; the session owns them. */
  get data() { return this.#recording?.data; }
  get sources(): Source[] { return [...this.data ? [this.data] : [], ...this.#switching ? [this.#switching] : []]; }
  get sampledFields(): readonly SampledField[] { return this.#recording?.fields ?? []; }
  get plot() { return this.#plotFeed?.plot; }
  #execution: Run | undefined;
  #results: RunResults | undefined;
  #branches: BranchState | undefined;
  #switching: Data | undefined;
  #observer = new Feed();

  constructor(client: Solver, document: CaseDocument, version: number, study: Study, carried: RunPreferences) {
    study = $state.snapshot(study);
    // Compiled now, so later settings never change what runs; a case GridKit cannot take fails the run, not the click that asked for it.
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
      // Compile and set up the GPU together. Without WebGL2 the study still runs; only its views fail.
      const [{ channels, ...request }] = await Promise.all([compiled,
        latkit().catch((cause: LatkitError) => { if (cause?.code !== 'unsupported') throw cause; })]);
      signal.throwIfAborted();
      const run = this.#execution = client.start(request), results = this.#results = new RunResults(run.results());
      const parts = { results, extend: (range: TimeRange) => this.#extend(range), failed: (cause: unknown) => { this.error = errorMessage(cause); } };
      const recording = this.#recording = new Recording({ ...parts, rows: Math.ceil(tmax / dt_monitor) + 1 + 2 * events.length });
      this.#plotFeed = new PlotFeed({ ...parts, timeline: this.timeline });
      this.#switching = new Data(branchStateDataset);
      this.#branches = new BranchState(this.#switching, branches, events);
      void run.artifacts.then(artifacts => { this.artifacts = artifacts; }, () => {});
      for await (const update of run.updates(signal)) {
        signal.throwIfAborted();
        this.failed = update.state === 'failed';
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
        this.#showPlot();
      }
    }, cause => {
      this.error = errorMessage(cause); this.failed = true; this.busy = false; this.playhead.pause();
      // Stop a run this page lost, so it does not hold the solver.
      void this.#execution?.cancel().catch(() => {});
    });
  }

  #extend(range: TimeRange) {
    this.range = [range[0], Math.max(this.range[1], range[1])];
    if (this.live) this.playhead.show(this.range[1]);
  }

  /** Installs the sampled fields the network's scene reads. */
  sample(fields: readonly SampledField[]) { this.#recording?.want(fields); }

  focusPlot(selected: ElementRef | null) {
    if (sameReference(selected, this.#selected)) return;
    this.#selected = selected;
    if (this.plotMode === 'focused') this.#showPlot();
  }
  setPlotMode(mode: 'all' | 'focused') {
    if (mode === this.plotMode) return;
    this.plotMode = mode; this.#showPlot();
  }
  pinPlot(selected: ElementRef) {
    const channel = this.quantity && channelsOf(this.quantity, [selected])[0];
    if (!channel || this.pinned.length >= pinnedSeriesLimit || this.pinned.some(ref => sameReference(ref, selected))) return;
    this.pinned = [...this.pinned, { ...selected, label: `${channel.class ?? 'Bus'} ${channel.label}` }];
    this.plotMode = 'focused'; this.#showPlot();
  }
  unpinPlot(selected: ElementRef) {
    this.pinned = this.pinned.filter(ref => !sameReference(ref, selected));
    if (this.plotMode === 'focused') this.#showPlot();
  }
  #showPlot() {
    const quantity = this.quantity;
    if (!quantity) return;
    const channels = this.plotMode === 'all' ? quantity.channels : channelsOf(quantity, [...this.pinned, ...this.#selected ? [this.#selected] : []]);
    if (!channels.length) { this.#plotFeed?.clear(); return; }
    const shown = this.plotMode === 'all' ? quantity : { ...quantity, channels };
    this.#plotFeed?.show(shown, this.basis, this.reference);
  }

  /** Plots `key`'s quantity; a bus quantity also becomes what the network shows. */
  select(key: string) {
    const quantity = this.quantities.find(quantity => quantity.key === key);
    if (!quantity || quantity === this.quantity) return;
    this.quantity = quantity;
    if (quantity.channels[0]?.element.collection === 'buses') this.#busQuantity = quantity;
    if (this.basis === 'percent' && !percentable(quantity.unit)) this.basis = 'change';
    this.band = null;
    this.#showPlot();
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
    this.#showPlot();
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

  async cancel() {
    if (!this.busy) return;
    if (!this.#execution) { this.#observer.stop(); this.busy = false; return; }
    try { await this.#execution.cancel(); } catch (cause) { this.error = errorMessage(cause); }
  }

  /** Stops everything the session runs and releases what it holds, cancelling a run still going. */
  close() {
    this.#observer.stop();
    this.playhead.pause();
    if (this.busy) void this.#execution?.cancel().catch(() => {});
    this.busy = false;
    this.#recording?.close();
    this.#plotFeed?.close();
    this.#switching?.destroy();
    this.#results?.close();
  }

  /** Asks the solver to stop, and waits for its answer. */
  async stop() { if (this.busy) await this.#execution?.cancel(); }
}
