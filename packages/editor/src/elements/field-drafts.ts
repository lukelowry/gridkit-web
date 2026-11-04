import * as z from 'zod';
import type { JsonObject, FieldInfo } from '@gridkit/library';

const json = z.json();
export interface FieldDraft { key: string; label: string; unit?: string | undefined; kind: string; text: string; missing?: boolean; choices?: readonly string[] | undefined }

export function fieldsOf(value: unknown, metadata: readonly FieldInfo[] = [], prefix = ''): FieldDraft[] {
  const values = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  const definitions = new Map(metadata.map(field => [field.id, field]));
  const keys = new Set([...Object.keys(values), ...metadata.filter(field => prefix && field.id.startsWith(prefix)).map(field => field.id.slice(prefix.length))]);
  return [...keys].map(key => {
    const item = values[key];
    const meta = definitions.get(`${prefix}${key}`);
    return { key, label: meta?.label ?? key, unit: meta?.unit,
      kind: item === undefined ? meta?.kind === 'bool' ? 'boolean' : meta?.kind === 'text' ? 'string' : 'number' : item === null || typeof item === 'object' ? 'json' : typeof item,
      missing: item === undefined, choices: meta?.choices,
      text: item === undefined ? '' : typeof item === 'string' ? item : JSON.stringify(item, null, 2),
    };
  });
}

export function fieldValue(field: FieldDraft): z.infer<typeof json> {
  if (field.kind === 'string') return field.text;
  if (!field.text.trim()) throw new Error('Enter a value.');
  const parsed: unknown = field.kind === 'number' ? Number(field.text) : JSON.parse(field.text);
  return json.parse(parsed);
}

export function valuesOf(fields: readonly FieldDraft[]): JsonObject {
  return Object.fromEntries(fields.map(field => [field.key, fieldValue(field)]));
}
