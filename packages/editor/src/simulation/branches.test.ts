import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { Data, load } from 'latkit';
import { CaseDocument, parseCase } from '@gridkit/library';
import { BranchState, branchStateTable } from './branches.js';
import { switchable, type SimulationEvent } from '@gridkit/library/gridkit';
import ieee39 from '../../../../library/IEEE39.case.json';
import wecc240 from '../../../../library/WECC240.case.json';
import { editCase } from '../domain/views.js';

await load({ wasm: await WebAssembly.compile(readFileSync(createRequire(import.meta.url).resolve('latkit/wasm'))) });

for (const input of [ieee39, wecc240]) it(`${input.header.case_name}: switches by snapshot identity, reverses events, and survives result replacement`, () => {
  const document = new CaseDocument(parseCase(JSON.stringify(input)));
  const rows = document.rows('devices').filter(switchable), [a, b] = rows;
  const branches = new Map(rows.map(row => [String(row.value.id), row.ref.id]));
  const events: SimulationEvent[] = [
    { type: 'out_of_service', time: 0, device: String(b!.value.id) },
    { type: 'fault_on', time: 0.5, bus: 1, R: 0, X: 0.1 },
    { type: 'out_of_service', time: 1, device: String(a!.value.id) },
    { type: 'out_of_service', time: 1.5, device: String(a!.value.id) },
    { type: 'in_service', time: 2, device: String(a!.value.id) },
    { type: 'out_of_service', time: 2, device: String(a!.value.id) },
    { type: 'in_service', time: 3, device: String(a!.value.id) },
  ];
  const data = new Data('simulation').axis('Time', 's'), state = new BranchState(data, branches, events);
  const value = (id: string) => data.get(branchStateTable, id, 'inService');
  expect(value(a!.ref.id)).toBe(1); expect(value(b!.ref.id)).toBe(0);
  // Edits to the next study and native IDs cannot change the captured run.
  events[2]!.time = 100; branches.clear();
  editCase(document, tx => tx.update(a!.ref, { id: 'renamed' }));
  const set = vi.spyOn(data, 'set');
  state.seek(0.9); expect(set).not.toHaveBeenCalled();
  state.seek(1); expect(value(a!.ref.id)).toBe(0); expect(set).toHaveBeenCalledTimes(1);
  state.seek(2.5); expect(set).toHaveBeenCalledTimes(1); // Repeated open and same-time close/open cancel out.
  state.seek(3); expect(value(a!.ref.id)).toBe(1);
  state.seek(2); expect(value(a!.ref.id)).toBe(0);
  state.seek(0); expect(value(a!.ref.id)).toBe(1); expect(value(b!.ref.id)).toBe(0);
  state.seek(20); expect(value(a!.ref.id)).toBe(1);
  data.replace('buses', ['sample-bus'], { Vm: [1] }).forget(100);
  expect(value(b!.ref.id)).toBe(0);
  expect(rows.slice(2).every(row => value(row.ref.id) === 1)).toBe(true);
  data.destroy();
});
