import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RunResults } from './results.js';

class WorkerStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { workers.push(this); }
}
let workers: WorkerStub[];
beforeEach(() => { workers = []; vi.stubGlobal('Worker', WorkerStub); });
afterEach(() => { vi.unstubAllGlobals(); });

it('closes a results port that arrives after its run was closed', async () => {
  let resolve!: (port: MessagePort) => void;
  const pending = new Promise<MessagePort>(done => { resolve = done; });
  const results = new RunResults(pending);
  results.close();
  const { port1, port2 } = new MessageChannel(), close = vi.spyOn(port1, 'close');
  try {
    resolve(port1);
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    expect(workers[0]!.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: 'close' });
  } finally { port1.close(); port2.close(); }
});

it('starts one worker on demand and transfers the result port once', async () => {
  const { port1, port2 } = new MessageChannel();
  const results = new RunResults(Promise.resolve(port1));
  try {
    await Promise.resolve();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminate).not.toHaveBeenCalled();
    const [command, options] = workers[0]!.postMessage.mock.calls[0]!;
    expect(command.kind).toBe('open');
    expect(command.port).toBe(port1);
    expect(options.transfer[0]).toBe(port1);
    workers[0]!.onmessage?.({ data: { id: 0 } } as MessageEvent);
    results.close();
  } finally { port1.close(); port2.close(); }
});
