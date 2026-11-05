import { SolverError, type ArtifactName, type RowsQuery, type RunId, type RunRequest, type SummaryQuery } from './index.js';
import type { ArtifactHeader, Command, Event, Reply, RowsHeader, RunStatus, SummaryHeader } from './protocol.js';
import { answer } from './reply.js';

/** What an implementation does in its worker. serve() does the rest: the page, each reader, aborts, and moving every part. */
export interface Backend {
  /** Resolves once `run` is accepted, or rejects it (busy, invalid); its statuses follow through the report. */
  start(run: RunId, request: RunRequest): Promise<void>;
  cancel(run: RunId): Promise<void>;
  rows(run: RunId, query: RowsQuery, signal: AbortSignal): Promise<Reply<RowsHeader>>;
  summary(run: RunId, query: SummaryQuery, signal: AbortSignal): Promise<Reply<SummaryHeader>>;
  artifact(run: RunId, name: ArtifactName, signal: AbortSignal): Promise<Reply<ArtifactHeader>>;
  close(): void;
}
/** How a backend says what its runs do, as they do it. */
export interface Report {
  status(run: RunId, status: RunStatus): void;
  /** Following `run` failed: its updates end with `cause`. */
  lost(run: RunId, cause: unknown): void;
}
/** Opens a backend with what the page gave, or answers that nothing is there. */
export type Open<Options> = (options: Options, report: Report) => Promise<Backend | null>;
/** Where a solver hears its page: its worker's scope, or a port. */
export interface Endpoint {
  postMessage(message: unknown, options: StructuredSerializeOptions): void;
  onmessage: ((event: MessageEvent) => unknown) | null;
}

/** A solver's worker: opens its backend as the page asks, then answers each command once, and each reader through its port. */
export function serve<Options>(open: Open<Options>, scope = self as unknown as Endpoint) {
  const send = (event: Event) => scope.postMessage(event, {});
  const report: Report = {
    status: (run, status) => send({ kind: 'status', run, status }),
    lost: (run, cause) => send({ kind: 'lost', run, error: SolverError.of(cause) }),
  };
  let backend: Backend | null = null;
  scope.onmessage = async ({ data }: MessageEvent<Command>) => {
    try {
      if (data.op === 'open') {
        backend?.close();
        backend = await open(data.options as Options, report);
        send({ kind: 'answer', id: data.id, ...!backend && { absent: true as const } });
        return;
      }
      const opened = backend;
      if (!opened) throw new SolverError('unavailable', 'The solver is not open.');
      switch (data.op) {
        case 'start': await opened.start(data.run, { study: data.study, model: data.model }); break;
        case 'cancel': await opened.cancel(data.run); break;
        case 'results': answer(data.port, (question, signal) => question.op === 'rows' ? opened.rows(data.run, question.query, signal)
          : question.op === 'summary' ? opened.summary(data.run, question.query, signal) : opened.artifact(data.run, question.name, signal)); break;
      }
      send({ kind: 'answer', id: data.id });
    } catch (cause) { send({ kind: 'answer', id: data.id, error: SolverError.of(cause) }); }
  };
}

/** A solver served in this thread, where there are no workers: the page's end of a channel to it. */
export function inThread<Options>(open: Open<Options>): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serve(open, port2);
  return port1;
}
