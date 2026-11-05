import { isTerminal, SolverError, type Failure, type RowsQuery, type RunState, type SummaryQuery } from '../index.js';
import type { Reply, RowsHeader, RunStatus, SummaryHeader } from '../protocol.js';
import type { GridKitEvent, GridKitStudy } from './gridkit.js';
import { checkRows, checkSummary, readRows, summarize } from './reads.js';
import { expired, Store, timeRange, type Blocks } from './store.js';

/** A run's files: one per level of its store, kept until the run is retired. */
export interface RunFiles {
  open(level: number): Promise<Blocks>;
  remove(): Promise<void>;
}
/** What the solver needs of where it runs: files for each run, GridKit for each study, and the page to tell. */
export interface HostDeps {
  files(run: string): Promise<RunFiles>;
  /** Starts GridKit on a study, reporting each event; stopping it ends it at once. */
  gridkit(study: GridKitStudy, report: (event: GridKitEvent) => void): { stop(): void };
  /** Each new status of a run; the last carries its log. */
  status(run: string, status: RunStatus, log?: string): void;
}

/** How long a read holds for more rows; the reader asks again if nothing came. */
const holdMs = 20_000;
/** How often row commits are announced, as the solver service announces them. */
const announceMs = 50;

/** One simulation: GridKit's study, what it has recorded, and who is waiting to hear. */
class HostRun {
  state: RunState = 'running';
  sequence = 1;
  failure: Failure | undefined;
  store: Store | undefined;
  retired = false;
  #log: string[] = [];
  #waiting = new Set<() => void>();
  #committed: Promise<void> = Promise.resolve();
  #announced = 0;
  #gridkit: { stop(): void } | undefined;

  constructor(readonly address: string, private files: RunFiles, private deps: HostDeps) {}

  get ended() { return isTerminal(this.state); }

  /** The page first hears of the run with its columns, or why it failed: until GridKit records, the run is preparing. */
  start(study: GridKitStudy) {
    this.#gridkit = this.deps.gridkit(study, event => this.#handle(event));
  }

  #handle(event: GridKitEvent) {
    if (this.ended || this.retired) return;
    switch (event.kind) {
      case 'columns':
        this.store = new Store(event.columns, level => this.files.open(level));
        this.#publish();
        break;
      case 'rows': {
        const store = this.store;
        this.#committed = this.#committed.then(async () => {
          if (this.ended || this.retired) return;
          if (!store) throw new SolverError('output', 'The recording has no time column.');
          await store.append(event.rows);
          if (performance.now() - this.#announced >= announceMs) this.#publish();
        }).catch(cause => this.#fail(cause));
        break;
      }
      case 'log':
        this.#log.push(event.text);
        break;
      case 'exit':
        void this.#committed.then(() => this.#end(event.status === 0 ? this.#recorded()
          : { code: 'simulation', message: `DynamicSimulation exited with code ${event.status}. Download the log for details.` }));
        break;
      case 'error':
        void this.#committed.then(() => this.#end({ code: 'simulation', message: event.message || 'DynamicSimulation stopped. Download the log for details.' }));
        break;
    }
  }

  /** A completed run has recorded something. */
  #recorded(): Failure | undefined {
    return this.store?.extent.rows ? undefined : { code: 'output', message: 'DynamicSimulation recorded no samples.' };
  }
  #fail(cause: unknown) {
    if (this.ended) return;
    this.#gridkit?.stop();
    const { message } = cause as { message?: string };
    this.#end({ code: 'output', message: message ?? String(cause) });
  }
  #end(failure: Failure | undefined, state: RunState = failure ? 'failed' : 'completed') {
    if (this.ended) return;
    this.failure = failure;
    this.#publish(state);
  }

  /** Stops GridKit and confirms it, once what it recorded is committed. */
  async cancel() {
    if (this.ended) return;
    this.#gridkit?.stop();
    await this.#committed;
    this.#end(undefined, 'cancelled');
  }

  /** Says what changed: readers hear at once, and the page with each status. */
  #publish(state?: RunState) {
    if (state) this.state = state;
    this.sequence++;
    for (const wake of [...this.#waiting]) wake();
    this.#announce();
  }
  #announce() {
    this.#announced = performance.now();
    this.deps.status(this.address, this.status(), this.ended ? this.#log.map(line => `${line}\n`).join('') : undefined);
  }

  status(): RunStatus {
    const view = this.store?.extent;
    return { sequence: this.sequence, state: this.state, rows: view?.rows ?? 0, range: view ? timeRange(view) : null,
      ...this.failure && { error: this.failure } };
  }

  /** The run's store, once it records; a retired run answers that it has expired. */
  recording(): Store {
    if (this.retired) throw expired();
    if (!this.store) throw new SolverError('unavailable', 'Nothing is recorded yet.');
    return this.store;
  }
  /** The run's state, unless it has been retired. */
  current(): RunState {
    if (this.retired) throw expired();
    return this.state;
  }

  /** Resolves once more than `rows` are committed, the run ends or is retired, or a read has held long enough. */
  hold(rows: number) {
    return new Promise<void>(resolve => {
      const done = () => this.retired || this.ended || (this.store?.extent.rows ?? 0) > rows;
      if (done()) { resolve(); return; }
      const finish = () => { clearTimeout(timer); this.#waiting.delete(wake); resolve(); };
      const wake = () => { if (done()) finish(); };
      const timer = setTimeout(finish, holdMs);
      this.#waiting.add(wake);
    });
  }

  /** Stops the run and removes what it recorded. */
  async retire() {
    this.retired = true;
    this.#gridkit?.stop();
    for (const wake of [...this.#waiting]) wake();
    await this.#committed;
    this.store?.retire();
    await this.files.remove();
  }
}

/** The solver service in this page: one run at a time, its rows read back as the service reads them. */
export class Host {
  #current: HostRun | undefined;

  constructor(private deps: HostDeps) {}

  /** Starts a study; only a good request retires the run before it. */
  async start(address: string, study: GridKitStudy) {
    if (this.#current && !this.#current.ended) throw new SolverError('busy', 'A simulation is already active.');
    const run = new HostRun(address, await this.deps.files(address), this.deps), previous = this.#current;
    this.#current = run;
    await previous?.retire();
    run.start(study);
  }

  async cancel(address: string) { await this.#run(address).cancel(); }

  #run(address: string) {
    const run = this.#current;
    if (!run || run.address !== address || run.retired) throw expired();
    return run;
  }

  /** Exact rows, as the solver service's rows answer them: one part, read for this reply alone. */
  async rows(address: string, query: RowsQuery): Promise<Reply<RowsHeader>> {
    const run = this.#run(address), store = run.recording(), plan = checkRows(store, query);
    if (query.wait) await run.hold(plan.from);
    const state = run.current(), view = store.extent, { first, count, values } = readRows(store, view, plan);
    return { header: { rows: view.rows, state, range: timeRange(view), first, count }, parts: [values.buffer] };
  }

  /** A summary's plan and its tiles' planes, as the solver service's summary answers them. */
  async summary(address: string, query: SummaryQuery): Promise<Reply<SummaryHeader>> {
    const run = this.#run(address), store = run.recording(), columns = checkSummary(store, query);
    if (query.after !== undefined) await run.hold(query.after);
    const state = run.current(), view = store.extent, plan = summarize(store, view, query, columns.length);
    return { header: { rows: view.rows, state, range: timeRange(view), ...plan },
      parts: plan.tiles.map(tile => store.planes(tile.level, tile.first, tile.rows, columns).buffer) };
  }

  /** The recording as CSV, as the solver service's results download has it: each chunk made only when it is asked for. */
  async *csv(address: string): AsyncGenerator<ArrayBuffer> {
    const store = this.#run(address).recording();
    for (const chunk of store.csv(store.extent)) yield chunk.buffer;
  }
}
