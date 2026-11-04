import { mount, unmount } from 'svelte';
import type { Library } from '@gridkit/library';
import type { Solver } from '@gridkit/solver';
import App from './app/App.svelte';
import { Connection } from './services/connection.svelte.js';
import { readyResults } from './simulation/results.js';
import { Simulation } from './simulation/simulation.svelte.js';
import { latkit } from './ui/latkit.js';
import './styles.css';

/** Connects to a service, or answers null where there is none. A failure is asked again, later and less often. */
export type Connect<T> = (signal: AbortSignal) => Promise<T | null>;
/** What the editor works with besides the case it edits. It shows its workspace without waiting for any of them. */
export interface EditorOptions {
  /** What runs studies: GridKit in the page, or a service beside it. */
  readonly solver: Connect<Solver>;
  /** Cases to open. */
  readonly library: Connect<Library>;
}

/** The editor, in `target`, whatever runs its studies and wherever it runs. Returns what removes it. */
export function mountEditor(target: Element, { solver, library }: EditorOptions): () => void {
  // Remove snapshots left by older versions. Never open or write a recovery database.
  try { indexedDB.deleteDatabase('gridkit-recovery'); } catch { /* Storage may be unavailable. */ }
  const connections = { solver: new Connection(solver), library: new Connection(library) };
  const app = mount(App, { target, props: { simulation: new Simulation(connections.solver), library: connections.library } });
  // Each service's first verdict is marked, for what waits on the editor to settle: its browser tests and probes. Then the first
  // run's results worker starts, out of the services' way.
  void Promise.all(Object.values(connections).map(service => service.connect())).then(() => {
    performance.mark('gridkit:services', {
      detail: Object.fromEntries(Object.entries(connections).map(([name, service]) => [name, { status: service.status, error: service.error }])),
    });
    readyResults();
  });
  // Failed connections retry on their own; coming back to the editor, or online, asks again whatever is not answering.
  const listening = new AbortController(), { signal } = listening;
  const recover = () => { for (const service of Object.values(connections)) service.recover(); };
  for (const event of ['online', 'focus']) window.addEventListener(event, recover, { signal });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recover(); }, { signal });
  // latkit compiles its WebAssembly and readies the GPU while a case is chosen.
  void latkit().catch(() => {});
  return () => {
    listening.abort();
    void unmount(app);
    connections.solver.value?.close();
  };
}
