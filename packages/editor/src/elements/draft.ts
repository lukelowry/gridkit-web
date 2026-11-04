import { elementCatalog, elementIssues, parameterIssues, portsOf, required, type CaseDocument, type Collection, type Connection, type ConnectionEnd, type ElementChanges, type ElementRecord, type ElementRef, type JsonObject, type ReadinessIssue, type Requirement } from '@gridkit/library';
import { fieldsOf, fieldValue, type FieldDraft } from './field-drafts.js';
import { entriesOf } from '../domain/entries.js';
import { busChoices, signalChoices, type ConnectionChoices } from './connection-choices.js';

export interface ElementRequest { ref: ElementRef }
export interface ElementSubmission { ref: ElementRef; changes: ElementChanges; connections: readonly { port: string; to: ConnectionEnd }[] }
export interface PortDraft {
  key: string; label: string; target: 'buses' | 'signals' | undefined; original: Connection | null; text: string; required: Requirement;
  choices?: ConnectionChoices | undefined;
}
export interface ElementDraft {
  collection: Collection; kind: string; identifier: string; name?: string;
  params?: FieldDraft[]; init?: FieldDraft[]; ports: PortDraft[];
}
export class DraftError extends Error {
  constructor(readonly issues: Record<string, string>) { super('Check the highlighted fields.'); }
}

export function createElementDraft(document: CaseDocument, request: ElementRequest): ElementDraft {
  const row = document.get(request.ref);
  if (!row) throw new Error('This element no longer exists.');
  const kind = row.ref.collection === 'signals' ? 'Signal' : String(row.value.class);
  const definition = elementCatalog.get(kind);
  const collection = row.ref.collection;
  const value = row.value;
  const metadata = document.fields({ collection, class: kind });
  const id = collection === 'buses' ? value.number : collection === 'signals' ? value.signal_id : value.id;
  const ports = portsOf(row);
  const entries = entriesOf(document), buses = busChoices(entries);
  const hasInit = !!definition?.init || !!value.init && typeof value.init === 'object' && !Array.isArray(value.init);
  return {
    collection, kind, identifier: String(id),
    ...(collection !== 'devices' || typeof value?.name === 'string' ? { name: String(value?.name ?? '') } : {}),
    ...(collection !== 'signals' ? { params: fieldsOf(value.params, metadata, 'params.') } : {}),
    ...(hasInit ? { init: fieldsOf(value.init, metadata, 'init.') } : {}),
    ports: [...new Set([...Object.keys(definition?.ports ?? {}), ...Object.keys(ports)])].map(key => {
      const original = ports[key] ?? null;
      const port = definition?.ports[key];
      const target = port?.target ?? (original && typeof original !== 'number' && original.collection !== 'devices' ? original.collection : undefined);
      return { key, label: port?.label ?? key, target, original, required: port?.required ?? false,
        choices: target === 'signals' ? signalChoices(entries, document, { element: row.ref, port: key }) : target === 'buses' ? buses : undefined,
        text: original === null ? '' : typeof original === 'number' ? String(original) : original.id };
    }),
  };
}

export function draftSignature(draft: ElementDraft): string {
  return JSON.stringify([draft.identifier, draft.name, draft.params?.map(field => field.text),
    draft.init?.map(field => field.text), draft.ports.map(port => port.text)]);
}

function readElementDraft(document: CaseDocument, request: ElementRequest, draft: ElementDraft) {
  const issues: Record<string, string> = {};
  const previous = document.get(request.ref)?.value;
  if (!previous) throw new Error('This element no longer exists.');
  const identifier = draft.collection === 'devices' ? draft.identifier : Number(draft.identifier);
  if (!draft.identifier.trim()) issues.identifier = 'Enter an identifier.';
  else if (typeof identifier === 'number' && (!Number.isSafeInteger(identifier) || identifier < 0)) issues.identifier = 'Enter a nonnegative whole number.';
  else {
    const old = previous && (draft.collection === 'buses' ? previous.number : draft.collection === 'signals' ? previous.signal_id : previous.id);
    if (identifier !== old && document.identifierTaken(draft.collection, identifier)) issues.identifier = 'This identifier is already in use.';
  }
  const definition = elementCatalog.get(draft.kind);
  function values(group: 'params' | 'init'): JsonObject | undefined {
    const fields = draft[group];
    if (!fields) return undefined;
    const result: Record<string, ReturnType<typeof fieldValue>> = Object.create(null);
    for (const field of fields) {
      if ((field.missing || field.choices || field.kind === 'number') && !field.text.trim()) continue;
      try { result[field.key] = fieldValue(field); }
      catch { issues[`${group}.${field.key}`] = field.kind === 'number' ? 'Enter a finite number.' : 'Enter valid JSON.'; }
    }
    for (const issue of parameterIssues(definition?.[group], result, previous ? (previous[group] ?? {}) as JsonObject : undefined)) {
      issues[`${group}.${String(issue.path[0])}`] ??= issue.message;
    }
    return result;
  }
  const params = values('params'), init = values('init');
  const ports: Record<string, Connection> = Object.create(null);
  const connections: { port: string; to: ConnectionEnd }[] = [];
  for (const port of draft.ports) {
    if (!port.text.trim()) continue;
    const originalText = port.original === null ? '' : typeof port.original === 'number' ? String(port.original) : port.original.id;
    if (port.original !== null && port.text === originalText) {
      ports[port.key] = port.original;
    } else if (port.target) {
      const target = port.choices?.byId.get(port.text)?.connection;
      if (!target) issues[`ports.${port.key}`] = `Choose an existing ${port.target === 'buses' ? 'bus' : 'signal or compatible port'}.`;
      else if ('element' in target) connections.push({ port: port.key, to: target });
      else ports[port.key] = target;
    } else {
      const number = Number(port.text);
      if (!port.text.trim() || !Number.isSafeInteger(number)) issues[`ports.${port.key}`] = 'Enter a whole number.';
      else ports[port.key] = number;
    }
  }
  const changes: ElementChanges = {
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    ...(params ? { params } : {}), ...(init ? { init } : {}),
    ...(draft.collection === 'buses' ? { number: identifier as number, ports }
      : draft.collection === 'signals' ? { signal_id: identifier as number } : { id: identifier as string, ports }),
  };
  return { changes, connections, issues };
}

export function submitElementDraft(document: CaseDocument, request: ElementRequest, draft: ElementDraft): ElementSubmission {
  const { changes, connections, issues } = readElementDraft(document, request, draft);
  if (Object.keys(issues).length) throw new DraftError(issues);
  return { ref: request.ref, changes, connections };
}

export function elementDraftIssues(document: CaseDocument, request: ElementRequest, draft: ElementDraft): ReadinessIssue[] {
  const { changes, connections, issues } = readElementDraft(document, request, draft);
  const row = document.get(request.ref)!;
  const current = { ...row, value: { ...row.value, ...changes } } as ElementRecord;
  return Object.entries({ ...Object.fromEntries(elementIssues(document, current).filter(issue => !connections.some(connection => issue.field === `ports.${connection.port}`)).map(issue => [issue.field, issue.message])), ...issues })
    .map(([field, message]) => ({ field, message }));
}

export function portRequired(draft: ElementDraft, port: PortDraft): boolean {
  const model = elementCatalog.get(draft.kind)?.model;
  if (!model) return false;
  if (typeof port.required === 'boolean') return port.required;
  const condition = port.required;
  const field = draft.params?.find(field => field.key === condition.parameter);
  const value = field?.text ? fieldValue(field) : undefined;
  return required(condition, { [condition.parameter]: value }, model);
}
