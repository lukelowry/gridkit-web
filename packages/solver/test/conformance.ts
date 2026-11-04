import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openReader, type ResultReader, type RunRequest, type RunUpdate, type Solver } from '../src/index.js';

/** A study for the solver under test, and some columns it records. */
export interface Study { readonly request: RunRequest; readonly columns: readonly string[] }
/** What a solver is held to the contract with. */
export interface Subject {
  connect(): Promise<Solver>;
  /** A study that records some rows, then completes. */
  quick(): Promise<Study>;
  /** A study that records, and goes on until it is cancelled. */
  long(): Promise<Study>;
}

async function last(updates: AsyncIterable<RunUpdate>) {
  let final: RunUpdate | undefined;
  for await (const update of updates) final = update;
  return final!;
}
async function reading<T>(reader: ResultReader, read: (reader: ResultReader) => Promise<T>) {
  try { return await read(reader); } finally { reader.close(); }
}

/** Holds a solver to what the editor relies on, whatever runs GridKit and wherever its results are kept. */
export function conformance(name: string, subject: Subject, timeout = 120_000) {
  describe(`${name} meets the solver contract`, { timeout }, () => {
    let solver: Solver;
    const signal = () => AbortSignal.timeout(timeout);
    beforeAll(async () => { solver = await subject.connect(); });
    afterAll(() => solver?.close());

    it('runs a study to completion, says how far it got as it goes, and reads it back whole', async () => {
      const { request, columns } = await subject.quick(), run = solver.start(request), states: string[] = [];
      let rows = 0;
      for await (const update of run.updates()) {
        states.push(update.state);
        if (update.progress) { expect(update.progress.rows).toBeGreaterThanOrEqual(rows); rows = update.progress.rows; }
      }
      expect(states[0]).toBe('preparing');
      expect(states.at(-1)).toBe('completed');
      expect(rows).toBeGreaterThan(0);
      await reading(openReader(await run.results()), async reader => {
        const { rows: recorded, state, samples } = await reader.rows({ columns, from: 0, maxBytes: 8 << 20 }, signal());
        expect({ recorded, state, first: samples.first }).toEqual({ recorded: rows, state: 'completed', first: 0 });
        expect(samples.times.length).toBeGreaterThan(0);
        expect(samples.values).toHaveLength(samples.times.length * columns.length);
        for (let i = 1; i < samples.times.length; i++) expect(samples.times[i]).toBeGreaterThanOrEqual(samples.times[i - 1]!);
        // A summary of the whole run covers every row once, its history and its edges together.
        const summary = await reader.summary({ columns, range: null, resolution: 64, maxBytes: 4 << 20 }, signal());
        let covered = 0;
        for await (const { level, block } of summary.pages()) covered += (block.kind === 'samples' ? block.times.length : block.starts.length) * 8 ** level;
        expect(covered).toBe(rows);
        await expect(reader.rows({ columns: ['no such column'], maxBytes: 4096 }, signal())).rejects.toMatchObject({ code: 'invalid' });
      });
      expect((await run.artifacts).map(artifact => artifact.name).sort()).toEqual(['log', 'results', 'solver']);
    });

    it('refuses a second study while one runs, and cancels one with what it recorded still readable', async () => {
      const long = await subject.long(), run = solver.start(long.request);
      for await (const update of run.updates()) if ((update.progress?.rows ?? 0) > 0) break;
      await expect(last(solver.start(long.request).updates())).rejects.toMatchObject({ code: 'busy' });
      await run.cancel();
      const final = await last(run.updates());
      expect(final.state).toBe('cancelled');
      expect(final.progress?.rows).toBeGreaterThan(0);
      const { state, samples } = await reading(openReader(await run.results()),
        reader => reader.rows({ columns: long.columns, from: 0, count: 1, maxBytes: 8 << 20 }, signal()));
      expect({ state, read: samples.times.length }).toEqual({ state: 'cancelled', read: 1 });
    });

    it('retires a run once the next starts', async () => {
      const { request, columns } = await subject.quick(), first = solver.start(request);
      await last(first.updates());
      await reading(openReader(await first.results()), async reader => {
        expect((await last(solver.start(request).updates())).state).toBe('completed');
        await expect(reader.rows({ columns, from: 0, maxBytes: 8 << 20 }, signal())).rejects.toMatchObject({ code: 'expired' });
      });
    });
  });
}
