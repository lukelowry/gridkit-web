import { mount, unmount } from 'svelte';
import type { Library } from '@gridkit/library';
import type { Solver } from '@gridkit/solver';
import App from './app/App.svelte';
import { Connection } from './services/connection.svelte.js';
import { Simulation } from './simulation/simulation.svelte.js';
import './styles.css';

/** Connects to a service, or answers null where there is none. A failure is asked again, later and less often. */
export type Connect<T> = (signal: AbortSignal) => Promise<T | null>;
/** What the UI works with besides the case it shows. It shows its workspace without waiting for any of them. */
export interface UiOptions {
  /** What runs studies: GridKit in the page, or a service beside it. */
  readonly solver: Connect<Solver>;
  /** Cases to open. */
  readonly library: Connect<Library>;
}

/** The UI, in `target`, whatever runs its studies and wherever it runs. Returns what removes it. */
export function mountUi(target: Element, { solver, library }: UiOptions): () => void {
  let disposed = false;
  const connections = { solver: new Connection(solver, value => value.close()), library: new Connection(library) };
  const app = mount(App, { target, props: { simulation: new Simulation(connections.solver), library: connections.library } });
  // Each service's first verdict is marked, for what waits on the UI to settle: its browser tests and probes. The results worker starts on the first run.
  void Promise.all(Object.values(connections).map(service => service.connect())).then(() => {
    if (disposed) return;
    performance.mark('gridkit:services', {
      detail: Object.fromEntries(Object.entries(connections).map(([name, service]) => [name, { status: service.status, error: service.error }])),
    });
  });
  // Failed connections retry on their own; coming back to the UI, or online, asks again whatever is not answering.
  const listening = new AbortController(), { signal } = listening;
  const recover = () => { for (const service of Object.values(connections)) service.recover(); };
  for (const event of ['online', 'focus']) window.addEventListener(event, recover, { signal });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recover(); }, { signal });
  return () => {
    if (disposed) return;
    disposed = true;
    listening.abort();
    void unmount(app);
    for (const service of Object.values(connections)) service.dispose();
  };
}
