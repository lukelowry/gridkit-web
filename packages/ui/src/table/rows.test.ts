import { expect, it } from 'vitest';
import type { Entry } from '../domain/entries.js';
import { displayCell } from '../ui/table.js';
import { classesOf, columnsOf, tableSource } from './rows.js';

const entry: Entry = { collection: 'devices', id: 'stable-1', label: 'line-1', name: '', class: 'Branch',
  fields: { 'params.R': 0.01, 'init.R': 1, 'ports.bus1': 10001, 'params.custom.label': 'kept' } };

it('keeps field identity and group context separate from readable table labels', () => {
  const metadata = Object.entries(entry.fields).map(([id, value]) => ({ id, label: id.slice(id.indexOf('.') + 1),
    kind: typeof value === 'number' ? 'number' as const : 'text' as const, presence: { present: 1, total: 1 } }));
  const columns = columnsOf([entry], '["devices","Branch"]', metadata);
  expect(columns.map(column => column.key)).toEqual(['ports.bus1', 'params.R', 'params.custom.label', 'init.R']);
  expect(columns.find(column => column.key === 'params.R')).toMatchObject({ label: 'R', group: 'Parameters', numeric: true });
  expect(columns.find(column => column.key === 'init.R')).toMatchObject({ label: 'R', group: 'Initial values' });
  expect(columns.find(column => column.key === 'params.custom.label')).toMatchObject({ label: 'custom.label', numeric: false });
  expect(tableSource([entry], columns).window('', null, 0, 10)).toMatchObject({ total: 1,
    rows: [{ cells: ['10001', '0.01', 'kept', '1'] }],
  });
});

it('distinguishes same-named classes in different collections', () => {
  const choices = classesOf([entry, { ...entry, id: 'stable-2', collection: 'signals' }]);
  expect(choices.map(choice => choice.display)).toEqual(['Branch (Devices)', 'Branch (Signals)']);
});

it('formats display precision without rounding the source or sort order', async () => {
  const rows = [0.77673471656, 0.77673471655].map((value, i) => ({ ...entry, id: String(i), fields: { 'params.R': value } }));
  const result = await tableSource(rows, [{ key: 'params.R', label: 'R', width: 136, numeric: true, precision: 6 }])
    .window('', { column: 0, dir: 'asc' }, 0, 2);
  expect(result.rows.map(row => row.key)).toEqual(['1', '0']);
  expect(result.rows[0]!.cells[0]).toBe('0.77673471655');
  expect(displayCell(result.rows[0]!.cells[0]!, 6)).toBe('0.776735');
  expect(displayCell('1.23456789e-12', 6)).toBe('1.23457e-12');
  expect(displayCell('10000001')).toBe('10000001');
});
