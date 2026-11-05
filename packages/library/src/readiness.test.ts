import { expect, it } from 'vitest';
import fixture from '../test/small.case.json';
import { parseCase, serializeCase } from './case.js';
import { CaseDocument } from './document.js';
import { baseIssues, caseReadiness } from './readiness.js';

it('accepts the supported fields in a valid fixture without changing it', () => {
  const value = parseCase(JSON.stringify(fixture));
  expect(baseIssues(value.params)).toEqual([]);
  expect(JSON.parse(serializeCase(value))).toEqual(fixture);
});

it('reports case bases and imported identifiers while preserving unfinished exports', () => {
  const original = {
    ...fixture,
    header: { ...fixture.header, case_name: '  ' },
    params: { ...fixture.params, freq_base: 0, va_base: -1 },
    buses: [
      { ...fixture.buses[0], number: 1 },
      { ...fixture.buses[0], number: 1 },
      { ...fixture.buses[0], number: -1 },
    ],
    signals: [
      { signal_id: 0, name: 'first' },
      { signal_id: 0, name: 'duplicate' },
      { signal_id: -1, name: 'unfinished' },
    ],
  };
  const value = parseCase(JSON.stringify(original));
  const document = new CaseDocument(value);
  const issues = caseReadiness(document);
  expect(issues.filter(issue => issue.ref === null).map(issue => issue.field)).toEqual(['freq_base', 'va_base']);
  expect(issues.filter(issue => issue.field === 'identifier')).toHaveLength(6);
  expect(issues.some(issue => issue.field === 'case_name')).toBe(false);
  const corrected = new CaseDocument({ ...value, params: { ...value.params, freq_base: 60, va_base: 100_000_000 } });
  expect(caseReadiness(corrected).filter(issue => issue.ref === null)).toEqual([]);
  expect(caseReadiness(document).filter(issue => issue.ref === null)).toHaveLength(2);
  expect(JSON.parse(serializeCase(value))).toEqual(original);
});
