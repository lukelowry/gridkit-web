import { expect, it } from 'vitest';
import raw from './manifest.json';
import { manifestSchema } from './manifest.js';

const manifest = manifestSchema.parse(raw);

it('keeps a complete manifest', () => {
  expect(manifest.models.find(model => model.id === 'BusInfinite')?.collection).toBe('buses');
  expect(manifest.models).toHaveLength(22);
  for (const model of manifest.models) for (const field of [...model.params, ...model.init]) {
    if (field.default === undefined) continue;
    expect(typeof field.default).toBe(field.type === 'string' ? 'string' : field.type === 'flag' ? 'boolean' : 'number');
    if (field.choices) expect(field.choices).toContain(field.default);
  }
});
