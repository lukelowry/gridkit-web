import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaseDocument, createCase, models, parseCase } from '@gridkit/library';
import { compile, type Study } from '@gridkit/library/gridkit';
import { openReader, type RunUpdate, type Solver } from '@gridkit/solver';
import { connect } from '@gridkit/solver/http';

/**
 * Real cases, compiled by the editor, run on the running stack's solver beside its editor: `pnpm smoke`. Each run replaces its
 * retained run. The solver package holds the service to the solver contract; these hold the editor's compile to GridKit.
 */
const base = new URL('api/solver/', `http://127.0.0.1:${process.env.GRIDKIT_EDITOR_PORT}/`).href;
const open = async (name: string) => new CaseDocument(parseCase(await readFile(new URL(`../../../library/${name}.case.json`, import.meta.url), 'utf8')));
async function finish(updates: AsyncIterable<RunUpdate>, each: (update: RunUpdate) => void = () => {}) {
  let last: RunUpdate | undefined;
  for await (const update of updates) { last = update; each(update); }
  return last!;
}

describe('studies GridKit runs', { timeout: 300_000 }, () => {
  let solver: Solver;
  beforeAll(async () => { solver = (await connect({ base }))!; expect(solver).not.toBeNull(); });
  afterAll(() => solver?.close());

  for (const [name, faulted] of [['IEEE39', 16], ['WECC240', 4005]] as const) it(`${name}: a fault runs, streams, and reads back exactly`, async () => {
    const document = await open(name), duration = 2;
    const study: Study = { tmax: duration, dt_monitor: 0.002, events: [
      { type: 'fault_on', time: 0.5, bus: faulted, R: 0.001, X: 0.02 }, { type: 'fault_off', time: 0.65, bus: faulted }] };
    const { channels, ...request } = compile(document, study), run = solver.start(request);
    const voltages = channels.filter(channel => channel.output === 'Vm'), ids = voltages.map(channel => channel.column);
    for await (const update of run.updates()) if (update.progress) break;
    // Rows wait for what is still to come, and end with the run.
    const reader = openReader(await run.results());
    const streamed = (async () => {
      for (let from = 0; ;) {
        const reply = await reader.rows({ columns: ids, from, wait: true, maxBytes: 4*1024*1024 });
        from = reply.samples.first + reply.samples.times.length;
        if (reply.state !== 'running' && from >= reply.rows) return reply.rows;
      }
    })();
    const final = await finish(run.updates());
    expect(final.state).toBe('completed');
    expect(voltages).toHaveLength(document.rows('buses').length);
    expect(await streamed).toBe(final.progress!.rows);

    // Every column this editor compiled is one GridKit recorded.
    const everything = channels.map(channel => channel.column);
    await reader.rows({ columns: everything, at: 0, count: 1, maxBytes: 8*1024*1024 });
    // Coarse tiles of the whole run keep the native recording's minimum exactly.
    const least = new Float64Array(ids.length).fill(Infinity);
    let coarse = 0;
    const summary = await reader.summary({ columns: ids, range: null, resolution: 64, maxBytes: 4*1024*1024 });
    for await (const { level, block } of summary.pages()) {
      if (level) coarse++;
      const values = block.kind === 'samples' ? block.values : block.minimum;
      for (const [index, value] of values.entries()) least[index % ids.length] = Math.min(least[index % ids.length]!, value);
    }
    expect(coarse, 'The whole run is drawn from the pyramid.').toBeGreaterThan(0);
    const { samples: initial } = await reader.rows({ columns: ids, at: 0, count: 1, maxBytes: 1024*1024 });
    const column = voltages.findIndex(channel => channel.label === String(faulted));
    expect(initial.values[column]! - least[column]!, 'The faulted bus shows a voltage drop.').toBeGreaterThan(0.05);
    const results = (await run.artifacts).find(artifact => artifact.name === 'results')!;
    const [heading, ...rows] = (await (await fetch('href' in results ? results.href : '')).text()).trim().split('\n').map(row => row.split(','));
    for (const [index, id] of ids.entries()) {
      const native = heading!.indexOf(id);
      expect(least[index]).toBe(Math.min(...rows.map(row => Number(row[native]))));
    }
    reader.close();
  });

  it.runIf(models.some(model => model.id === 'FunctionSignalSource'))('simulates exported function sources and signal buses', async () => {
    const document = new CaseDocument(parseCase(JSON.stringify({ ...createCase(),
      buses: [
        { number: 1, class: 'BusInfinite', name: 'Infinite', params: { kv: 230 }, init: { Vr: 1, Vi: 0 } },
        { number: 2, class: 'SignalVoltageIn', name: 'Input', params: { kv: 230 }, ports_in: { vr: 0, vi: 1 }, ports_out: { ir: 2, ii: 3 } },
        { number: 3, class: 'SignalVoltageOut', name: 'Output', params: { kv: 230 }, init: { Vr: 1, Vi: 0 }, ports_in: { ir: 2, ii: 3 } },
      ],
      devices: [
        { class: 'FunctionSignalSource', id: 'source', ports: { sr: 0, si: 1 }, params: { Fr: 'sin', Fi: 'cos' } },
        { class: 'FunctionSignalSource', id: 'default-source', ports: {}, params: {} },
        { class: 'Branch', id: 'branch', ports: { bus1: 1, bus2: 3 }, params: { R: 0, X: 0.01 } },
        { class: 'LoadZ', id: 'load', ports: { bus: 2 }, params: { R: 1, X: 0 } },
      ],
      signals: [
        { signal_id: 0, name: 'Voltage real' }, { signal_id: 1, name: 'Voltage imaginary' },
        { signal_id: 2, name: 'Current real' }, { signal_id: 3, name: 'Current imaginary' },
      ],
    })));
    const { study, model } = compile(document, { tmax: 0.1, dt_monitor: 0.01 });
    const final = await finish(solver.start({ study, model }).updates());
    expect(final.state, final.state === 'failed' ? final.error.message : '').toBe('completed');
  });
});
