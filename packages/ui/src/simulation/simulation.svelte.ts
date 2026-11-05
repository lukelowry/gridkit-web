import type { CaseDocument } from '@gridkit/library';
import type { Connection } from '../services/connection.svelte.js';
import type { Solver } from '@gridkit/solver';
import { RunSession, type RunPreferences } from './run.svelte.js';
import type { Study } from '@gridkit/library/gridkit';

/** The solver the UI runs studies on, and the one run on show. */
export class Simulation {
  readonly solver: Connection<Solver>;
  /** The run on show, from its start until its results are closed. */
  run = $state.raw<RunSession | null>(null);
  #carried: RunPreferences = { basis: 'value', band: null, speed: 1 };

  constructor(solver: Connection<Solver>) { this.solver = solver; }

  get available() { return this.solver.value !== null; }
  get busy() { return this.run?.busy ?? false; }

  /** Replaces the run on show with a new one of `study`, unless one is still going. */
  start(document: CaseDocument, version: number, study: Study) {
    const client = this.solver.value;
    if (!client || this.busy) return;
    this.close();
    this.run = new RunSession(client, document, version, study, this.#carried);
  }
  /** Closes the results, discarding them and stopping the run if it is still going. */
  close() {
    const run = this.run;
    if (!run) return;
    this.#carried = { basis: run.basis, band: run.band, speed: run.playhead.speed };
    this.run = null;
    run.close();
  }
  /** Stops the run, waiting for the solver's answer, then closes it. */
  async stop() {
    await this.run?.stop();
    this.close();
  }
}
