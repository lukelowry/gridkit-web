import { expect, it } from 'vitest';
import ieee39 from '../../../../library/IEEE39.case.json';
import wecc240 from '../../../../library/WECC240.case.json';
import { CaseDocument, elementCatalog, parseCase } from '@gridkit/library';
import { channelsOf, quantitiesOf } from './channels.js';
import type { Channel } from '@gridkit/library/gridkit';

for (const fixture of [ieee39, wecc240]) it(`${fixture.header.case_name}: groups channel metadata without native column names`, () => {
  const document = new CaseDocument(parseCase(JSON.stringify(fixture)));
  const channels: Channel[] = [];
  for (const collection of ['buses', 'devices'] as const) for (const row of document.rows(collection)) {
    const outputs = elementCatalog.get(String(row.value.class))!.model.outputs;
    const recorded = collection === 'buses' ? ['Vm'] : row.value.mon ?? [];
    for (const name of recorded as string[]) {
      const output = outputs.find(output => output.id.toLowerCase() === name.toLowerCase())!;
      channels.push({ column: `channel-${channels.length}`, element: row.ref, output: output.id, unit: output.unit ?? '', label: String(row.value.id ?? row.value.number) });
    }
  }
  const quantities = quantitiesOf(channels);
  expect(quantities.find(quantity => quantity.output === 'Vm')!.channels).toHaveLength(fixture.buses.length);
  expect(quantities.flatMap(quantity => quantity.channels)).toEqual(channels);
  if (fixture.header.case_name === 'WECC240') expect(quantities.find(quantity => quantity.output === 'omega')!.channels).toHaveLength(103);
  const first = channels[0]!;
  expect(quantitiesOf([first, { ...first, unit: 'V' }, { ...first, element: { collection: 'devices', id: 'same-output' } }])).toHaveLength(3);
});

it('finds focused series by element and keeps pinned selection order without duplicates', () => {
  const channels: Channel[] = Array.from({ length: 1000 }, (_, i) => ({ column: String(i), element: { collection: 'buses', id: `b${i}` }, output: 'Vm', label: String(i), unit: 'p.u.' }));
  const quantity = quantitiesOf(channels)[0]!;
  expect(channelsOf(quantity, [channels[999]!.element, channels[0]!.element, channels[999]!.element]))
    .toEqual([channels[999], channels[0]]);
  expect(channelsOf(quantity, [{ collection: 'devices', id: 'b999' }])).toEqual([]);
});
