import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Data, load } from 'latkit';
import { PlotBuffer } from './plot.js';
import { packPlot } from './results.worker.js';
import type { Tile } from '@gridkit/solver';

beforeAll(async () => {
  await load({ wasm: await WebAssembly.compile(new Uint8Array(await readFile(new URL(import.meta.resolve('latkit/wasm'))))) });
});

type Part = Pick<Tile, 'level' | 'first' | 'block'>;
/** A page of one update: by default the whole of it. */
const page = ({ history = [], edges = [], begin = true, reset = true, seal = true, complete = true, columns = ['v'] }:
  { history?: Part[]; edges?: Part[]; begin?: boolean; reset?: boolean; seal?: boolean; complete?: boolean; columns?: string[] }) =>
  packPlot(columns, [...history.map(tile => ({ ...tile, target: 'history' as const })), ...edges.map(tile => ({ ...tile, target: 'edge' as const }))], 'value', undefined,
    { rows: 1001, state: 'running', range: [0, 10], begin, reset, seal, complete });
function samples(first: number, times: number[], values = times): Part {
  return { level: 0, first, block: { kind: 'samples', first, columns: ['v'],
    times: Float64Array.from(times), values: Float64Array.from(values) } };
}

it('keeps the previous plot visible until the entire replacement commits, and discards cancelled pages', () => {
  const data = new Data('simulation-plot');
  let view = new PlotBuffer(data);
  try {
    view.apply(page({ history: [samples(0, [0, 1], [1, 2])] }));
    view.apply(page({ seal: false, complete: false, history: [samples(0, [0], [3])] }));
    expect(data.get('Trace', 'v', 'value', { at: 0 })).toBe(1);
    view.destroy(); view = new PlotBuffer(data); // viewport superseded midway
    view.apply(page({ seal: false, complete: false, history: [samples(0, [0], [4])] }));
    expect(data.get('Trace', 'v', 'value', { at: 0 })).toBe(1);
    view.apply(page({ begin: false, reset: false, history: [samples(1, [1], [5])] }));
    expect(data.get('Trace', 'v', 'value', { at: 0 })).toBe(4);
    expect(data.get('Trace', 'v', 'value', { at: 1 })).toBe(5);
  } finally { view.destroy(); data.destroy(); }
});

it('replaces partial edge runs without accumulating old tails or splitting duplicate-time events', () => {
  const data = new Data('simulation-plot'), view = new PlotBuffer(data);
  try {
    view.apply(page({ history: [samples(0, [0, 1], [1, 2])], edges: [samples(2, [1, 2], [3, NaN])] }));
    expect(data.get('Trace', 'v', 'value', { at: 1 })).toBe(3);
    expect(data.get('Trace', 'v', 'value', { at: 2 })).toBeNull();
    // Former edge rows become sealed: restoring history removes their old run before they are written again.
    view.apply(page({ reset: false, history: [samples(2, [1, 2], [3, NaN])], edges: [samples(4, [3], [4])] }));
    expect(data.describe().tables).toHaveLength(1);
    expect(data.describe().span).toEqual([0, 3]);
    expect(data.get('Trace', 'v', 'value', { at: 1 })).toBe(3);
    expect(data.get('Trace', 'v', 'value', { at: 2 })).toBeNull();
    expect(data.get('Trace', 'v', 'value', { at: 3 })).toBe(4);
  } finally { view.destroy(); data.destroy(); }
});

it('preserves every time and channel in a fragmented 10,000-channel transient', () => {
  const ids = Array.from({ length: 10000 }, (_, i) => `bus-${i}`);
  const data = new Data('simulation-plot'), view = new PlotBuffer(data);
  const signal = (row: number, column: number) => (row < 50 ? 1 : 1-0.2*Math.exp(-(row/100-0.5)/0.7)) + column/100000;
  try {
    for (let first = 0; first < 1001; first += 26) {
      const rows = Math.min(26, 1001-first), last = first+rows === 1001;
      const times = Float64Array.from({ length: rows }, (_, i) => (first+i)/100);
      const values = Float64Array.from({ length: rows*ids.length }, (_, i) => signal(first+Math.floor(i/ids.length), i%ids.length));
      const packed = page({ columns: ids, begin: first === 0, reset: first === 0, seal: last, complete: last,
        history: [{ level: 0, first, block: { kind: 'samples', first, times, values, columns: ids } }] });
      expect(packed.history.byteLength + packed.edges.byteLength).toBeLessThan(2*1024*1024);
      expect(view.apply(packed)).toBe(last);
      if (!last) expect(data.describe().tables).toHaveLength(0);
    }
    expect(data.describe().tables[0]!.rows).toBe(10000);
    expect(data.describe().span).toEqual([0, 10]);
    for (const row of [49, 50, 51, 63, 64, 65, 511, 512, 513, 959, 960, 961, 1000])
      for (const column of [0, 39, 240, 9999])
        expect(data.get('Trace', ids[column]!, 'value', { at: row/100 })).toBe(Math.fround(signal(row, column)));
  } finally { view.destroy(); data.destroy(); }
});
