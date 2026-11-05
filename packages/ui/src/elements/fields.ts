import type { JsonObject, FieldInfo } from '@gridkit/library';
export interface FieldValue { key: string; label: string; unit?: string | undefined; multiline: boolean; text: string }

/** Display native values without coercing numbers, booleans, or unknown JSON fields. */
export function fieldsOf(value: unknown, metadata: readonly FieldInfo[] = [], prefix = ''): FieldValue[] {
  const values = value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  const definitions = new Map(metadata.map(field => [field.id, field]));
  const keys = new Set([...Object.keys(values), ...metadata.filter(field => prefix && field.id.startsWith(prefix)).map(field => field.id.slice(prefix.length))]);
  return [...keys].map(key => {
    const item = values[key], meta = definitions.get(prefix + key);
    return { key, label: meta?.label ?? key, unit: meta?.unit, multiline: item !== null && typeof item === 'object',
      text: item === undefined ? 'Not set' : typeof item === 'string' ? item : JSON.stringify(item, null, 2) };
  });
}
