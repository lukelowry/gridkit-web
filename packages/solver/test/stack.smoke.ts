import { readFile } from 'node:fs/promises';
import { connect } from '../src/http/index.js';
import { conformance } from './conformance.js';

// The running local stack's solver service, held to the contract through the editor container that mounts it: `pnpm smoke`.
const base = `http://127.0.0.1:${process.env.GRIDKIT_EDITOR_PORT}/api/solver/`;

/** IEEE39 as GridKit reads it, recording every output; the editor's compile wrote it. */
const model = await readFile(new URL('./ieee39.model.json', import.meta.url));
const study = (tmax: number, dt_monitor: number) => async () => ({
  request: { study: { tmax, dt_monitor, rel_tol: 1e-5, abs_tol: 1e-5, max_steps: Number.MAX_SAFE_INTEGER, events: [] },
    model: new Blob([model], { type: 'application/json' }) },
  columns: ['Bus_1_Vm', 'Bus_2_Vm', 'Bus_3_Vm'],
});

conformance('The solver service', {
  connect: async () => (await connect({ base }))!,
  quick: study(0.2, 0.002),
  long: study(10_000, 0.0001),
});
