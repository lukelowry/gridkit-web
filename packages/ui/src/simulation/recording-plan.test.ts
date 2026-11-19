import { expect, it } from 'vitest';
import type { Channel } from '@gridkit/library/gridkit';
import { networkPlan, recordingStride } from './recording-plan.js';

const channel = (id: string, model: string, output: string): Channel => ({ column: `${id}:${output}`,
  element: { collection: 'devices', id }, class: model, output, label: id, unit: '' });

it('separates model tables and budgets their actual dense arrays, including missing cells', () => {
  const plan = networkPlan([channel('a', 'Genrou', 'omega'), channel('b', 'Genrou', 'P'), channel('c', 'LoadZ', 'P')]);
  expect(plan.tables.map(table => [table.name, table.ids, table.fields.map(field => field.name)]))
    .toEqual([['Genrou', ['a', 'b'], ['omega', 'P']], ['LoadZ', ['c'], ['P']]]);
  expect(plan.bytesPerFrame).toBe(2 * (8 + 4 * 2) + 8 + 4);
  const stride = recordingStride(plan, 1000, 4096);
  expect(plan.fixedBytes + Math.ceil(1000 / stride) * plan.bytesPerFrame).toBeLessThanOrEqual(4096 * 0.8);
  expect(() => recordingStride(plan, 1000, 16)).toThrow('memory budget');
});
