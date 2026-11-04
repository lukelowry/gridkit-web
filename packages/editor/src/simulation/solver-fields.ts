import type { EventType, Study, StudyIssue } from '@gridkit/library/gridkit';
import type { IconName } from '../ui/icons.js';

export const solverFields = [
  { key: 'tmax', label: 'Duration', unit: 's', group: '', min: 0, step: 'any' },
  { key: 'dt_monitor', label: 'Output interval', unit: 's', group: '', min: 0, step: 'any' },
  { key: 'rel_tol', label: 'Relative tolerance', unit: '', group: 'Integration', min: 0, step: 'any' },
  { key: 'abs_tol', label: 'Absolute tolerance', unit: '', group: 'Integration', min: 0, step: 'any' },
  { key: 'dt_fixed', label: 'Integration step', unit: 's', group: 'Integration', min: 0, step: 'any' },
  { key: 'max_steps', label: 'Maximum steps', unit: '', group: 'Integration', min: 0, step: '1' },
  { key: 'max_order', label: 'Maximum order', unit: '', group: 'Integration', min: 1, step: '1' },
] as const satisfies readonly { key: keyof Study; label: string; unit: string; group: string; min: number; step: string }[];
export const initialization = { key: 'consistent_ic_type', label: 'Initialization', group: 'Integration' } as const;
export const eventActions = {
  fault_on: { label: 'Fault bus', icon: 'fault' },
  fault_off: { label: 'Clear fault', icon: 'undo' },
  out_of_service: { label: 'Open line', icon: 'line-open' },
  in_service: { label: 'Close line', icon: 'line-close' },
} as const satisfies Record<EventType, { label: string; icon: IconName }>;
const fieldLabels: Record<string, string> = Object.fromEntries([
  ...solverFields.map(field => [field.key, field.label]), [initialization.key, initialization.label],
  ['bus', 'Bus'], ['device', 'Line'], ['time', 'Time'], ['R', 'Resistance'], ['X', 'Reactance'], ['impedance', 'Impedance'],
]);
export function issueLabel(issue: StudyIssue): string {
  const field = String(issue.path.at(-1) ?? 'Settings');
  return `${issue.path[0] === 'events' ? `Event ${Number(issue.path[1]) + 1}, ` : ''}${fieldLabels[field] ?? field}: ${issue.message}`;
}
