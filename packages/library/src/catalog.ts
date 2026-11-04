import * as z from 'zod';
import raw from './manifest.json';
import { manifestSchema, type Model, type Requirement } from './manifest.js';
import type { Collection, JsonObject } from './case.js';

export type { Model } from './manifest.js';

export const models = manifestSchema.parse(raw).models;
export interface PortDefinition {
  readonly target: 'buses' | 'signals'; readonly label: string; readonly direction: 'in' | 'out' | 'both';
  readonly required: Requirement; readonly output: boolean; readonly path: readonly ['ports' | 'ports_in' | 'ports_out', string];
}
export interface ElementDefinition {
  readonly collection: 'buses' | 'devices'; readonly label: string; readonly family: string; readonly model: Model;
  readonly ports: Readonly<Record<string, PortDefinition>>;
  readonly params: z.ZodObject; readonly init?: z.ZodObject;
}

function defaultsOf(fields: Model['params']): JsonObject {
  return Object.fromEntries(fields.flatMap(field => field.default === undefined ? [] : [[field.id, field.default] as const]));
}

function parameters(fields: Model['params'], kind: string) {
  const defaults = defaultsOf(fields);
  const shape = Object.fromEntries(fields.map(field => {
    let value: z.ZodType = field.type === 'flag' ? z.boolean() : field.type === 'integer' ? z.int() : field.type === 'string' ? field.choices ? z.enum(field.choices) : z.string() : z.number({ error: 'Enter a finite number.' });
    if (kind === 'Branch' && field.id === 'tap') value = z.number().positive('Tap ratio must be greater than zero.');
    value = value.optional();
    return [field.id, value.meta({ title: field.label ?? field.id, unit: field.unit, choices: field.choices })];
  }));
  return z.object(shape).catchall(z.json()).superRefine((stored, context) => {
    const value = { ...defaults, ...stored };
    if ((kind === 'Branch' || kind === 'LoadZ') && value.R === 0 && value.X === 0) for (const key of ['R', 'X'])
      context.addIssue({ code: 'custom', path: [key], message: 'Resistance and reactance cannot both be zero.' });
  });
}

/** Each model's fields and connections. */
export const elementCatalog: ReadonlyMap<string, ElementDefinition> = new Map(models.map(model => {
  const ports = Object.fromEntries(model.ports.map(port => [port.name, {
    target: port.kind === 'bus' ? 'buses' as const : 'signals' as const, label: port.label ?? port.name,
    direction: port.direction, required: port.required, output: port.direction === 'out', path: port.path ?? ['ports', port.name] as const,
  }]));
  const definition: ElementDefinition = {
    collection: model.collection, label: model.label, family: model.family, model, ports,
    params: parameters(model.params, model.id), ...(model.init.length ? { init: parameters(model.init, model.id) } : {}),
  };
  return [model.id, definition] as const;
}));

export function elementValues(kind: string, params: JsonObject = {}) {
  const definition = elementCatalog.get(kind);
  if (!definition) throw new Error(`Cannot create ${kind}.`);
  const model = definition.model;
  return { class: kind, params: definition.params.parse({ ...defaultsOf(model.params), ...model.preset?.params, ...params }) as JsonObject,
    ...(definition.init ? { init: definition.init.parse({ ...defaultsOf(model.init), ...model.preset?.init }) as JsonObject } : {}) };
}
export function portCollection(kind: string, port: string): Collection | undefined {
  const ports = elementCatalog.get(kind)?.ports;
  return ports && Object.hasOwn(ports, port) ? ports[port]?.target : undefined;
}
export function parameterIssues(schema: z.ZodObject | undefined, value: JsonObject, previous?: JsonObject) {
  if (!schema) return [];
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.filter(issue => {
    const key = String(issue.path[0]);
    return !previous || JSON.stringify(previous[key]) !== JSON.stringify(value[key]);
  });
}
