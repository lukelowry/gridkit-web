import * as z from 'zod';
import { MediaQuery } from 'svelte/reactivity';
import {
  preferenceFields, preferenceKeys, defaults, tableSchema,
  type Preferences, type PreferenceKey, type TablePreferences,
} from './definitions.js';
import { defaultMarks, mappingDraft, type MappingTransaction } from '../domain/views.js';
import { readSavedViews, record } from '@gridkit/library';

const storageKey = 'gridkit.preferences';
function parse(text: string) {
  let stored: Record<string, unknown> = {};
  try { stored = record(JSON.parse(text)) ?? {}; } catch { /* Use defaults. */ }
  const value = Object.fromEntries(preferenceKeys.map(key => {
    const read = preferenceFields[key].schema.safeParse(stored[key]);
    return [key, read.success ? read.data : defaults[key]];
  })) as Preferences;
  function records<T>(schema: z.ZodType<T>, input: unknown): Record<string, T> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return Object.fromEntries(Object.entries(input).flatMap(([key, item]) => {
      const result = schema.safeParse(item);
      return result.success ? [[key, result.data]] : [];
    }));
  }
  const mappings = readSavedViews(stored.mappings);
  const tables = records(tableSchema, stored.tables);
  return { value, mappings, tables };
}

export function createPreferences(snapshot?: string) {
  let text = snapshot ?? '{}';
  if (snapshot === undefined) try { text = localStorage.getItem(storageKey) ?? '{}'; } catch { /* Use defaults. */ }
  const initial = parse(text);
  let value = $state.raw(initial.value);
  let mappings = $state.raw(initial.mappings);
  let tables = $state.raw(initial.tables);
  let issue = $state('');
  const dark = new MediaQuery('(prefers-color-scheme: dark)');
  const reduce = new MediaQuery('(prefers-reduced-motion: reduce)');
  const contrast = new MediaQuery('(prefers-contrast: more)'), forced = new MediaQuery('(forced-colors: active)');
  const serialize = () => JSON.stringify({ ...value, mappings, tables });
  function save() {
    if (snapshot !== undefined) return;
    try { localStorage.setItem(storageKey, serialize()); issue = ''; }
    catch { issue = 'Preferences apply now but could not be saved in this browser.'; }
  }
  return {
    serialize,
    apply(text: string) {
      const next = parse(text);
      value = next.value; mappings = next.mappings; tables = next.tables;
      save();
    },
    get value() { return value; },
    get issue() { return issue; },
    get theme() { return value.theme === 'system' ? (dark.current ? 'dark' : 'light') : value.theme; },
    get motion() { return value.motion === 'reduce' || reduce.current ? 'reduce' as const : 'full' as const; },
    get contrast() { return value.contrast === 'high' || contrast.current || forced.current ? 'high' : 'normal'; },
    get(key: PreferenceKey) { return value[key]; },
    modified(key: PreferenceKey) { return value[key] !== defaults[key]; },
    set(key: PreferenceKey, next: unknown) {
      value = { ...value, [key]: preferenceFields[key].schema.parse(next) };
      save();
    },
    reset(keys: PreferenceKey | readonly PreferenceKey[]) {
      const list = typeof keys === 'string' ? [keys] : keys;
      value = { ...value, ...Object.fromEntries(list.map(key => [key, defaults[key]])) };
      save();
    },
    get mappings() { return mappings; },
    editMappings(build: (tx: MappingTransaction) => void) {
      const draft = mappingDraft(mappings, defaultMarks);
      build(draft);
      mappings = draft.value;
      save();
    },
    table(key: string): TablePreferences { return tables[key] ?? { columns: [], sort: null }; },
    setTable(key: string, next: Partial<TablePreferences>) {
      tables = { ...tables, [key]: tableSchema.parse({ ...tables[key], ...next }) };
      save();
    },
  };
}
export type PreferencesState = ReturnType<typeof createPreferences>;
