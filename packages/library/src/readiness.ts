import type { CaseDocument, ElementRecord } from './document.js';
import { elementCatalog, parameterIssues } from './catalog.js';
import { record } from './fields.js';
import { collections, type ElementRef, type JsonObject } from './case.js';
import { required } from './manifest.js';
import { signalOutputs, portsOf } from './connections.js';

export interface ReadinessIssue { readonly field: string; readonly message: string }
export interface CaseIssue extends ReadinessIssue { readonly ref: ElementRef | null }
export function baseIssues(value: { freq_base?: number | undefined; va_base?: number | undefined }): ReadinessIssue[] {
  return (['freq_base', 'va_base'] as const).flatMap(field =>
    typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] > 0 ? [] :
      [{ field, message: `${field === 'freq_base' ? 'Frequency' : 'Power'} base must be greater than zero.` }]);
}
export function elementIssues(document: CaseDocument, row: ElementRecord): ReadinessIssue[] {
  if (row.ref.collection === 'signals') return [];
  const kind = String(row.value.class), definition = elementCatalog.get(kind);
  if (!definition) return [{ field: 'class', message: `Unknown model: ${kind}.` }];
  const model = definition.model;
  const issues: ReadinessIssue[] = [];
  for (const group of ['params', 'init'] as const) {
    const values = (record(row.value[group]) ?? {}) as JsonObject;
    for (const field of model[group]) if (required(field.required, row.value.params as JsonObject, model) && values[field.id] === undefined)
      issues.push({ field: `${group}.${field.id}`, message: `Set ${field.label ?? field.id}.` });
    for (const issue of parameterIssues(definition[group], values))
      issues.push({ field: `${group}.${String(issue.path[0])}`, message: issue.message });
  }
  const ports = portsOf(row);
  for (const [name, port] of Object.entries(definition.ports)) {
    const connection = ports[name];
    if (connection === undefined && !required(port.required, row.value.params as JsonObject, model)) continue;
    const ref = record(connection);
    const target = ref && document.get({ collection: port.target, id: String(ref.id) });
    if (!target) issues.push({ field: `ports.${name}`, message: `Connect ${port.label}.` });
    else if (port.target === 'signals' && signalOutputs([
      ...document.dependents(target.ref).filter(ref => ref.id !== row.ref.id).map(ref => document.get(ref)!), row,
    ], target.ref).length !== 1)
      issues.push({ field: `ports.${name}`, message: `${port.label} needs a signal with one output.` });
  }
  return issues;
}
export function caseReadiness(document: CaseDocument): CaseIssue[] {
  return [
    ...baseIssues(document.info.params).map(issue => ({ ...issue, ref: null })),
    ...collections.flatMap(collection => document.rows(collection).flatMap(row => {
      const identifier = collection === 'buses' ? row.value.number : collection === 'signals' ? row.value.signal_id : row.value.id;
      const issues = elementIssues(document, row);
      if (typeof identifier === 'number' && identifier < 0) issues.push({ field: 'identifier', message: 'Identifiers must be nonnegative.' });
      else if (typeof identifier === 'string' && !identifier.trim()) issues.push({ field: 'identifier', message: 'Enter a device ID.' });
      if ((typeof identifier === 'number' || typeof identifier === 'string') && document.identifierTaken(collection, identifier, row.ref))
        issues.push({ field: 'identifier', message: `Identifier ${identifier} is duplicated.` });
      return issues.map(issue => ({ ...issue, ref: row.ref }));
    })),
  ];
}
