import { describe, expect, it } from 'vitest';
import fixture from '../test/small.case.json';
import { createCase, parseCase, serializeCase } from './case.js';


describe('case files', () => {
  it('preserves native data', () => {
    const restored = JSON.parse(serializeCase(parseCase(JSON.stringify(fixture))));
    expect(restored).toEqual(fixture);
  });

  it('preserves absent fields', () => {
    const { signals: _signals, header, ...rest } = createCase();
    const { format_version: _version, format_revision: _revision, ...unversionedHeader } = header;
    const original = { ...rest, header: unversionedHeader };
    const restored = JSON.parse(serializeCase(parseCase(JSON.stringify(original))));
    expect(restored).toEqual(original);
  });

  it('writes real parameters as floating-point literals without changing native IDs or unknown data', () => {
    const value = parseCase(JSON.stringify({ ...fixture, devices: [
      { class: 'LoadZ', id: 'load', ports: { bus: 1 }, params: { R: 1, X: 0, extra: 2 } },
      { class: 'Unknown', id: 'unknown', ports: {}, params: { R: 1 } },
    ] }));
    const text = serializeCase(value);
    expect(text).toContain('"R": 1.0');
    expect(text).toContain('"X": 0.0');
    expect(text).toContain('"bus": 1\n');
    expect(text).toContain('"extra": 2');
    expect(text).toContain('"R": 1\n');
    expect(JSON.parse(text)).toEqual(value);
  });

  it.each(['{', '{}', 'null', '[]'])('rejects an unreadable case: %s', text => {
    expect(() => parseCase(text)).toThrow();
  });

  it('rejects unsupported versions', () => {
    const original = createCase();
    const text = JSON.stringify({ ...original, header: { ...original.header, format_version: 9 } });
    expect(() => parseCase(text)).toThrow('header.format_version');
  });

  it('rejects nonfinite numbers and unsafe identifiers', () => {
    const text = JSON.stringify(fixture).replace('100000000', '1e999');
    expect(() => parseCase(text)).toThrow('params.va_base');
    expect(() => parseCase(JSON.stringify({
      ...fixture,
      buses: [{ ...fixture.buses[0], number: Number.MAX_SAFE_INTEGER + 1 }],
    }))).toThrow('buses.0.number');
  });

  it.each([
    ['buses.0.params.nested.0.value', { ...fixture, buses: [{ ...fixture.buses[0], params: { nested: [{ value: 'overflow' }] } }] }],
    ['devices.0.extension.value', { ...fixture, devices: [{ ...fixture.devices[0], extension: { value: 'overflow' } }] }],
    ['extension.value', { ...fixture, extension: { value: 'overflow' } }],
  ])('rejects overflow inside opaque JSON at %s', (path, value) => {
    expect(() => parseCase(JSON.stringify(value).replace('"overflow"', '1e999'))).toThrow(`${path}: Expected a finite number.`);
  });

  it('deeply freezes parameters and opaque data on import', () => {
    const value = parseCase(JSON.stringify({ ...fixture, extension: { nested: [{ enabled: true }] } }));
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.buses)).toBe(true);
    expect(Object.isFrozen(value.buses[0]!.params)).toBe(true);
    const extension = value.extension as { nested: { enabled: boolean }[] };
    expect(Object.isFrozen(extension.nested[0])).toBe(true);
    expect(() => { extension.nested[0]!.enabled = false; }).toThrow();
  });

  it('creates independent cases', () => {
    const first = createCase();
    const second = createCase();
    expect(first).not.toBe(second);
    expect(first.buses).not.toBe(second.buses);
    expect(first.params).toEqual({ freq_base: 60, va_base: 100_000_000 });
    expect(first.buses).toEqual([]);
  });
});
