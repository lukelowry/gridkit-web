import { artifactFiles, isTerminal, SolverError, type Artifact, type ArtifactName, type Run, type RunId, type RunRequest, type Solver } from './index.js';
import type { ArtifactHeader, Command, Event } from './protocol.js';
import { Asker } from './reply.js';
import { RunUpdates, updateOf } from './updates.js';

type Commanding = Command extends infer C ? C extends Command ? Omit<C, 'id'> : never : never;
type Answered = Extract<Event, { kind: 'answer' }>;

/** The page's side of a solver, whichever does the work: commands to its worker, and each run's updates as it tells them. */
export async function client<Options>(worker: Worker | MessagePort, options: Options, signal?: AbortSignal): Promise<Solver | null> {
  const link = new Link(worker);
  try {
    signal?.throwIfAborted();
    if ((await link.command({ op: 'open', options }, [], signal)).absent) { link.close(); return null; }
  } catch (cause) { link.close(); throw cause; }
  return { start: request => link.start(request), close: () => link.close() };
}

class Link {
  #id = 0;
  #answers = new Map<number, { resolve(answer: Answered): void; reject(error: unknown): void }>();
  /** Each run still going, by the name this page gave it. */
  #runs = new Map<RunId, RunUpdates>();
  #closed: Error | undefined;

  constructor(private worker: Worker | MessagePort) {
    worker.onmessage = ({ data }: MessageEvent<Event>) => {
      if (data.kind === 'status') {
        this.#runs.get(data.run)?.publish(updateOf(data.status));
        if (isTerminal(data.status.state)) this.#runs.delete(data.run);
      } else if (data.kind === 'lost') {
        this.#runs.get(data.run)?.finish(new SolverError(data.error.code, data.error.message));
        this.#runs.delete(data.run);
      } else {
        const answer = this.#answers.get(data.id);
        this.#answers.delete(data.id);
        if (data.error) answer?.reject(new SolverError(data.error.code, data.error.message)); else answer?.resolve(data);
      }
    };
    if ('onerror' in worker) worker.onerror = event => { event.preventDefault(); this.close(new SolverError('internal', event.message || 'The solver stopped.')); };
  }

  command(command: Commanding, transfer: Transferable[] = [], signal?: AbortSignal): Promise<Answered> {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = this.#id++;
    return new Promise((resolve, reject) => {
      const abort = () => { this.#answers.delete(id); reject(signal!.reason); };
      this.#answers.set(id, {
        resolve: answer => { signal?.removeEventListener('abort', abort); resolve(answer); },
        reject: error => { signal?.removeEventListener('abort', abort); reject(error); },
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ ...command, id }, { transfer });
    });
  }

  start({ study, model }: RunRequest): Run {
    const run = crypto.randomUUID(), updates = new RunUpdates();
    this.#runs.set(run, updates);
    this.command({ op: 'start', run, study, model }).catch(cause => { this.#runs.delete(run); updates.finish(cause); });
    const results = async () => {
      const { port1, port2 } = new MessageChannel();
      await this.command({ op: 'results', run, port: port1 }, [port1]);
      return port2;
    };
    const artifacts = updates.ended.then(() => artifactsOf(results));
    // A run that never ends offers nothing; whoever asks hears why.
    artifacts.catch(() => {});
    return {
      updates: signal => updates.watch(signal),
      cancel: () => isTerminal(updates.current.state) ? Promise.resolve() : this.command({ op: 'cancel', run }).then(() => {}),
      results,
      artifacts,
    };
  }

  close(error: Error = new DOMException('The solver closed.', 'AbortError')) {
    if (this.#closed) return;
    this.#closed = error;
    for (const updates of this.#runs.values()) updates.finish(error);
    this.#runs.clear();
    if ('terminate' in this.worker) this.worker.terminate(); else this.worker.close();
    for (const answer of this.#answers.values()) answer.reject(error);
    this.#answers.clear();
  }
}

/** What a run offers, each as its solver gives it: a link, or bytes made as they are written. */
async function artifactsOf(results: () => Promise<MessagePort>): Promise<readonly Artifact[]> {
  const asker = new Asker(await results());
  try {
    return await Promise.all((Object.keys(artifactFiles) as ArtifactName[]).map(async (name): Promise<Artifact> => {
      const file = artifactFiles[name], { header } = await asker.ask<ArtifactHeader>({ op: 'artifact', name });
      return header.href ? { name, file, href: header.href } : { name, file, write: output => written(results, name, output) };
    }));
  } finally { asker.close(); }
}
/** Writes the artifact `name` into `output` as its solver makes it, a part each time the last is written, and closes it. */
async function written(results: () => Promise<MessagePort>, name: ArtifactName, output: WritableStream<Uint8Array>) {
  const asker = new Asker(await results()), writer = output.getWriter();
  try {
    const { parts } = await asker.ask({ op: 'artifact', name });
    for await (const part of parts) await writer.write(new Uint8Array(part));
    await writer.close();
  } finally { writer.releaseLock(); asker.close(); }
}
