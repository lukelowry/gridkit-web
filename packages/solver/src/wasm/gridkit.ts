// What the host says to GridKit's own worker, and hears back from it, and the worker readied for each study.

/** The study as the solver service gives it to GridKit: the model beside it, its output where the solver reads it, as numbers. */
export function settingsOf(study: object, model: string, output: string): object {
  const { reference_file: _, ...settings } = study as Record<string, unknown>;
  return { ...settings, system_model_file: model, output_file: output, output_format: 'binary' };
}

/** One study for GridKit: its settings, and its model. */
export interface GridKitStudy { readonly settings: object; readonly model: Blob }
/** A GridKit worker is readied ahead of its study, from the module the solver compiled once, then given the study. */
export type GridKitCommand =
  | { readonly kind: 'prepare'; readonly module: string; readonly wasm: WebAssembly.Module }
  | ({ readonly kind: 'study' } & GridKitStudy);
/**
 * What GridKit's worker reports: that GridKit is ready for a study (or the error why not), then the study's columns, whole rows of
 * [t, values…] as they are written, and how main returned.
 */
export type GridKitEvent =
  | { readonly kind: 'ready' }
  | { readonly kind: 'columns'; readonly columns: readonly string[] }
  | { readonly kind: 'rows'; readonly rows: Float64Array<ArrayBuffer> }
  | { readonly kind: 'log'; readonly text: string }
  | { readonly kind: 'exit'; readonly status: number }
  | { readonly kind: 'error'; readonly message: string };

/** What the solver needs of a worker it runs GridKit in. */
export type GridKitWorker = Pick<Worker, 'postMessage' | 'onmessage' | 'onerror' | 'terminate'>;

const messageOf = (cause: unknown) => cause instanceof Error && cause.message ? cause.message : String(cause);

/**
 * GridKit for each study, from `module`, compiled once for the page. The worker for the next study is readied ahead of it and
 * watched from the start: one whose script or GridKit cannot load is replaced once, and never handed a study it would not run.
 * A failed download is tried again by the next worker rather than kept.
 */
export function gridkit(module: string, spawn: () => GridKitWorker, compile: () => Promise<WebAssembly.Module>) {
  let wasm: Promise<WebAssembly.Module> | undefined;
  const compiled = () => wasm ??= compile().catch((cause: unknown) => { wasm = undefined; throw cause; });
  /** A worker that settles once GridKit is instantiated in it, or with why it could not be. */
  const prepare = () => {
    const worker = spawn();
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<GridKitEvent>) => {
        if (data.kind === 'ready') resolve(); else if (data.kind === 'error') reject(new Error(data.message));
      };
      worker.onerror = event => { event.preventDefault(); reject(new Error(event.message || 'GridKit could not be downloaded.')); };
      compiled().then(wasm => worker.postMessage({ kind: 'prepare', module, wasm } satisfies GridKitCommand), reject);
    });
    ready.catch(() => worker.terminate());
    return { worker, ready };
  };
  let spare = prepare();

  /** Starts GridKit on `study`, reporting each event; stopping it ends it at once. */
  return (study: GridKitStudy, report: (event: GridKitEvent) => void): { stop(): void } => {
    const taken = spare;
    spare = prepare();
    let running: GridKitWorker | undefined, stopped = false;
    const stop = () => { stopped = true; running?.terminate(); };
    void (async () => {
      // A worker that could not load, as over a dropped connection, is replaced once before the study is given up.
      const { worker } = await taken.ready.then(() => taken, async () => { const fresh = prepare(); await fresh.ready; return fresh; });
      running = worker;
      if (stopped) { worker.terminate(); return; }
      worker.onmessage = ({ data }: MessageEvent<GridKitEvent>) => {
        // A study's GridKit holds all the memory it grew until its worker ends.
        if (data.kind === 'exit' || data.kind === 'error') stop();
        report(data);
      };
      worker.onerror = event => { event.preventDefault(); stop(); report({ kind: 'error', message: event.message || 'GridKit stopped.' }); };
      worker.postMessage({ kind: 'study', ...study } satisfies GridKitCommand);
    })().catch((cause: unknown) => {
      if (stopped) return;
      stop();
      report({ kind: 'error', message: `GridKit could not start: ${messageOf(cause)}` });
    });
    return { stop };
  };
}
