import { expect, it } from 'vitest';
import { fieldsOf, valuesOf } from './field-drafts.js';

it('drafts typed JSON as text and reads it back as it was', () => {
  const data = { kv: 230, number: 12, text: '12', flag: true, nested: { a: [1, 'two', null] } };
  expect(valuesOf(fieldsOf(data))).toEqual(data);
});
