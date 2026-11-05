import type { Scene, Theme } from 'latkit';
import { record, type ElementTarget, type FieldInfo } from '@gridkit/library';
import { optionIssue, fieldsIn, mergeTheme, readMark, type MarkDefinition, type Diagnostic } from '../domain/views.js';
import { numericConstraint, numericIssue } from './numeric.js';
import { measureOf } from '../domain/measure.js';

const sameMark = (a: MarkDefinition, b: MarkDefinition) => a.id === b.id && a.kind === b.kind && a.target.collection === b.target.collection
  && (a.target.class === undefined || a.target.class === b.target.class);
export interface ResolvedMappings { space?: Scene['space']; theme: Exclude<Theme, string>; marks: readonly MarkDefinition[]; diagnostics: readonly Diagnostic[] }

/**
 * Merge options atomically; expressions, arrays and compound options are never deep-merged. A mapping of what a run records waits
 * for `simulation`, drawing what it inherits until one has results.
 */
export function resolveMappings(defaults: readonly MarkDefinition[], user: unknown, saved: unknown,
  fields: (target: ElementTarget) => readonly FieldInfo[], simulation = false): ResolvedMappings {
  const diagnostics: Diagnostic[] = [];
  let marks = defaults.map(mark => ({ ...mark, options: { ...mark.options } } as MarkDefinition));
  let space: Scene['space'] | undefined;
  let theme: Exclude<Theme, string> = {};
  for (const [layer, input] of [['defaults', user], ['case', saved]] as const) {
    if (input === undefined) continue;
    const path = `${layer}.network`, data = record(input);
    const report = (at: string, message: string, code: Diagnostic['code'] = 'invalid') => diagnostics.push({ path: at, message, code });
    if (!data) { report(path, 'Expected view mappings.'); continue; }
    for (const key of Object.keys(data)) if (!['space', 'theme', 'marks'].includes(key)) report(`${path}.${key}`, 'Unrecognized view option.', 'unsupported');
    if (data.space !== undefined) space = data.space as Scene['space'];
    if (data.theme !== undefined) {
      if (record(data.theme)) theme = mergeTheme(theme, record(data.theme)!);
      else report(`${path}.theme`, 'Invalid theme; using the inherited theme.');
    }
    if (data.marks === undefined) continue;
    if (!Array.isArray(data.marks)) { report(`${path}.marks`, 'Expected an ordered list of marks.'); continue; }
    const inherited = new Map(marks.map(mark => [mark.id, mark]));
    const next: MarkDefinition[] = [], ids = new Set<string>();
    data.marks.forEach((input, index) => {
      const at = `${path}.marks[${index}]`, mark = readMark(input);
      if (!mark || ids.has(mark.id)) { report(at, 'Invalid or duplicate mark; preserved but inactive.'); return; }
      for (const key of Object.keys(record(input)!)) if (!['id', 'target', 'kind', 'options'].includes(key)) report(`${at}.${key}`, 'Unrecognized mark option; preserved.', 'unsupported');
      ids.add(mark.id);
      const base = inherited.get(mark.id);
      if (base && !sameMark(base, mark)) { report(at, 'Mark identity conflicts with the inherited mark.'); return; }
      const options: Record<string, unknown> = { ...base?.options };
      const available = new Map(fields(mark.target).map(field => [field.id, field]));
      for (const [key, value] of Object.entries(mark.options)) {
        const issue = optionIssue(key) ?? numericIssue(value, numericConstraint(key));
        if (issue) { report(`${at}.options.${key}`, issue); continue; }
        const read = fieldsIn(value);
        if (!simulation && read.some(id => id.startsWith('simulation.'))) continue;
        const missing = read.filter(id => !available.has(measureOf(id).output));
        if (missing.length) { report(`${at}.options.${key}`, `Unknown field: ${missing.join(', ')}.`, 'missing-field'); continue; }
        options[key] = value;
      }
      next.push({ ...mark, options } as MarkDefinition);
    });
    marks = next;
  }
  return { ...(space === undefined ? {} : { space }), theme, marks, diagnostics };
}
