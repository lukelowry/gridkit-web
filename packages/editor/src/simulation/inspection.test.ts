import { expect, it } from 'vitest';
import type { Channel } from '@gridkit/library/gridkit';
import { PlotElements } from './inspection.js';

it('maps recording columns to bus and device identities without mixing equal ids', () => {
  const bus = { collection: 'buses', id: '1' } as const, edge = { collection: 'devices', id: '1' } as const;
  const channels: Channel[] = [
    { column: 'bus-v', element: bus, output: 'Vm', unit: 'p.u.', label: 'North' },
    { column: 'edge-i', element: edge, output: 'I', unit: 'p.u.', label: 'Line' },
    { column: 'edge-other', element: edge, output: 'I', unit: 'p.u.', label: 'Line other end' },
  ];
  const links = new PlotElements('simulation-plot', channels);
  expect(links.rows(bus)).toEqual([{ data: 'simulation-plot', table: 'Trace', ids: ['bus-v'] }]);
  expect(links.rows(edge)).toEqual([{ data: 'simulation-plot', table: 'Trace', ids: ['edge-i', 'edge-other'] }]);
  expect(links.channel({ data: 'simulation-plot', table: 'Trace', id: 'edge-i' })?.element).toEqual(edge);
  expect(links.channel({ data: 'case', table: 'Trace', id: 'bus-v' })).toBeUndefined();
  expect(links.rows({ collection: 'buses', id: 'missing' })).toEqual([]);
  expect(links.rows(null)).toEqual([]);
});
