import type { GridKitCommand, GridKitEvent } from './gridkit.js';

/** The parts of GridKit's Emscripten module a study uses. */
interface GridKit {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: string | Uint8Array, options?: { canOwn: boolean }): void;
    makedev(major: number, minor: number): number;
    registerDevice(device: number, operations: { write(stream: unknown, bytes: Int8Array, offset: number, length: number): number }): void;
    mkdev(path: string, device: number): void;
  };
  callMain(args: string[]): number;
}
type CreateGridKit = (options: {
  quit(status: number, cause: unknown): never;
  print(text: string): void;
  printErr(text: string): void;
  instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void): object;
}) => Promise<GridKit>;

/** How often rows go to the solver while GridKit records them. */
const batchMs = 50;
const post = (event: GridKitEvent, transfer: Transferable[] = []) => self.postMessage(event, { transfer });

/**
 * GridKit's binary output, however it is written: its header line of columns, then whole rows of doubles, t first. The rows are
 * copied once, out of GridKit's memory into the buffer that is then sent whole to the solver.
 */
class Output {
  #header: Uint8Array<ArrayBuffer> | null = new Uint8Array(0);
  #pending = new Uint8Array(1 << 20);
  #length = 0;
  #row = 0;
  #posted = performance.now();

  write(bytes: Uint8Array) {
    if (this.#header) {
      const end = bytes.indexOf(10);
      const header = new Uint8Array(this.#header.length + (end < 0 ? bytes.length : end));
      header.set(this.#header); header.set(end < 0 ? bytes : bytes.subarray(0, end), this.#header.length);
      if (end < 0) { this.#header = header; return; }
      const columns = new TextDecoder().decode(header).split(',');
      this.#header = null;
      this.#row = 8 * columns.length;
      post({ kind: 'columns', columns: columns.slice(1) });
      bytes = bytes.subarray(end + 1);
    }
    if (this.#length + bytes.length > this.#pending.length) {
      const grown = new Uint8Array(Math.max(2 * this.#pending.length, this.#length + bytes.length));
      grown.set(this.#pending.subarray(0, this.#length));
      this.#pending = grown;
    }
    this.#pending.set(bytes, this.#length);
    this.#length += bytes.length;
    if (performance.now() - this.#posted >= batchMs) this.flush();
  }

  /** Sends every whole row held, moving the buffer they are in; a partial row starts the next. */
  flush() {
    const whole = this.#row ? this.#length - this.#length % this.#row : 0;
    this.#posted = performance.now();
    if (!whole) return;
    const sent = this.#pending;
    this.#pending = new Uint8Array(sent.length);
    this.#pending.set(sent.subarray(whole, this.#length));
    this.#length -= whole;
    post({ kind: 'rows', rows: new Float64Array(sent.buffer, 0, whole / 8) }, [sent.buffer]);
  }
}

/** GridKit, instantiated from the module the solver compiled, ahead of its study. */
async function prepare(module: string, wasm: WebAssembly.Module) {
  const { default: create } = await import(/* @vite-ignore */ module) as { default: CreateGridKit };
  const report = (text: string) => post({ kind: 'log', text });
  return create({
    // quit hands control back here, where Node would end the process.
    quit: (_status, cause) => { throw cause; },
    print: report,
    printErr: report,
    instantiateWasm: (imports, done) => { void WebAssembly.instantiate(wasm, imports).then(done); return {}; },
  });
}
let ready: Promise<GridKit> | undefined;

// One study. GridKit's main holds this worker until it returns, so the solver stops a run by ending the worker.
self.onmessage = async ({ data }: MessageEvent<GridKitCommand>) => {
  if (data.kind === 'prepare') {
    ready = prepare(data.module, data.wasm);
    // The solver hears this worker can take a study, or why it cannot.
    ready.then(() => post({ kind: 'ready' }), (cause: unknown) => post({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) }));
    return;
  }
  try {
    if (!ready) throw new Error('GridKit was given a study before its module.');
    const gridkit = await ready, { settings, model } = data;
    const { FS } = gridkit, output = new Output(), device = FS.makedev(64, 0);
    FS.mkdir('/run');
    // The file system keeps the model's bytes as read, rather than a copy of them.
    FS.writeFile('/run/model.json', new Uint8Array(await model.arrayBuffer()), { canOwn: true });
    FS.writeFile('/run/study.json', JSON.stringify(settings));
    FS.registerDevice(device, { write: (_stream, bytes, offset, length) => {
      output.write(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, length));
      return length;
    } });
    FS.mkdev('/run/rows', device);
    const status = gridkit.callMain(['/run/study.json']);
    output.flush();
    post({ kind: 'exit', status });
  } catch (cause) {
    post({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) });
  }
};
