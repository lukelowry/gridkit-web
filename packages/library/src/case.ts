import * as z from 'zod';
import { elementCatalog } from './catalog.js';

// What writes 1.0 as 1.0, which the JSON library leaves to newer runtimes.
declare global {
  interface JSON { rawJSON(text: string): object }
}

// Check row structure here; freezeJson checks opaque values without cloning them.
const jsonObject = z.record(z.string(), z.unknown());
const identifier = z.int();

const headerSchema = z.object({
  format_version: z.literal(0.2).optional(),
  format_revision: z.int().nonnegative().optional(),
  case_name: z.string(),
  case_description: z.string(),
  case_comments: z.string(),
}).catchall(z.unknown());

const paramsSchema = z.object({
  freq_base: z.number(),
  va_base: z.number(),
}).catchall(z.unknown());

const busSchema = z.object({
  number: identifier,
  class: z.string(),
  name: z.string(),
  params: jsonObject,
}).catchall(z.unknown());

const deviceSchema = z.object({
  class: z.string(),
  id: z.string(),
  ports: z.record(z.string(), identifier),
  params: jsonObject,
}).catchall(z.unknown());

const signalSchema = z.object({
  signal_id: identifier,
  name: z.string(),
}).catchall(z.unknown());

const caseShape = z.object({
  header: headerSchema,
  params: paramsSchema,
  buses: z.array(busSchema),
  devices: z.array(deviceSchema),
  signals: z.array(signalSchema).optional(),
}).catchall(z.unknown());
const caseSchema = caseShape.brand<'Case'>();

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

export type CaseValue = Immutable<z.infer<typeof caseShape>>;
export type Case = CaseValue & z.$brand<'Case'>;
export type Bus = Immutable<z.infer<typeof busSchema>>;
export type JsonObject = Bus['params'];
export type Device = Immutable<z.infer<typeof deviceSchema>>;
export type Signal = Immutable<z.infer<typeof signalSchema>>;
export type Collection = 'buses' | 'devices' | 'signals';
export interface ElementRef<C extends Collection = Collection> { readonly collection: C; readonly id: string }
export const collections: readonly Collection[] = ['buses', 'devices', 'signals'];

export type Details =
  Pick<Case['header'], 'case_name' | 'case_description' | 'case_comments'> &
  Pick<Case['params'], 'freq_base' | 'va_base'>;

export function detailsOf(value: Pick<Case, 'header' | 'params'>): Details {
  return {
    case_name: value.header.case_name,
    case_description: value.header.case_description,
    case_comments: value.header.case_comments,
    freq_base: value.params.freq_base,
    va_base: value.params.va_base,
  };
}

export function createCase(): Case {
  return freezeJson(caseSchema.parse({
    header: {
      format_version: 0.2,
      format_revision: 0,
      case_name: 'Untitled',
      case_description: '',
      case_comments: '',
    },
    params: {
      freq_base: 60,
      va_base: 100_000_000,
    },
    buses: [],
    devices: [],
    signals: [],
  }));
}

export function parseCase(text: string): Case {
  let input: unknown;

  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('The file does not contain valid JSON.');
  }

  const result = caseSchema.safeParse(input);
  if (!result.success) {
    const messages = result.error.issues.slice(0, 4).map(issue => {
      const path = issue.path.join('.') || 'case';
      return `${path}: ${issue.message}`;
    });
    throw new Error(messages.join('\n'));
  }

  return freezeJson(result.data);
}

/** Validate and deep-freeze JSON at import boundaries without allocating a second tree. */
export function freezeJson<T>(value: T): T {
  const path: (string | number)[] = [];
  const fail = (message: string): never => { throw new Error(`${path.join('.') || 'case'}: ${message}`); };
  function visit(item: unknown): void {
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('Expected a finite number.');
      return;
    }
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item !== 'object') return fail('Expected a JSON value.');
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) { path.push(index); visit(item[index]); path.pop(); }
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) fail('Expected a JSON object.');
      for (const key in item) if (Object.hasOwn(item, key)) {
        path.push(key); visit((item as Record<string, unknown>)[key]); path.pop();
      }
    }
    Object.freeze(item);
  }
  visit(value);
  return value;
}

/** Deep-freeze owned data; shared document subtrees are already deeply frozen. */
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const child of value) freeze(child);
    } else {
      for (const key in value) if (Object.hasOwn(value, key)) freeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function realLiterals(rows: Iterable<Bus | Device>) {
  const fields = new WeakMap<object, ReadonlySet<string>>();
  for (const row of rows) {
    const model = elementCatalog.get(row.class)?.model;
    for (const group of ['params', 'init'] as const) {
      const values = row[group];
      if (model && values && typeof values === 'object')
        fields.set(values, new Set(model[group].filter(field => field.type === 'real').map(field => field.id)));
    }
  }
  return function (this: object, key: string, value: unknown) {
    // GridKit's native parameter variants distinguish 1.0 from 1.
    return typeof value === 'number' && Number.isInteger(value) && fields.get(this)?.has(key)
      ? JSON.rawJSON(value.toFixed(1)) : value;
  };
}

/** Serialize a single native row without losing the parser's real/integer distinction. */
export function serializeCaseRow(value: Bus | Device): string {
  return JSON.stringify(value, realLiterals([value]));
}

export function serializeCase(value: Case): string {
  function* rows() { yield* value.buses; yield* value.devices; }
  return `${JSON.stringify(value, realLiterals(rows()), 2)}\n`;
}
