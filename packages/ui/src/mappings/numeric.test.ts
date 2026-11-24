import { expect, it } from 'vitest';
import { CaseDocument, parseCase } from '@gridkit/library';
import fixture from '../../../library/test/small.case.json';
import { categoryExamples } from './numeric.js';

it('samples a device class even when its first row is beyond the collection sample limit', () => {
  const devices = [...Array.from({ length: 520 }, (_, i) => ({ ...fixture.devices[1], id: String(i) })), fixture.devices[0]];
  const document = new CaseDocument(parseCase(JSON.stringify({ ...fixture, devices })));
  expect(categoryExamples(document, { collection: 'devices', class: 'Branch' }, 'class')).toEqual(['Branch']);
});
