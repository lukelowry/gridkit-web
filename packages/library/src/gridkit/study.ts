import { z } from 'zod';
import type { CaseDocument, ElementRecord } from '../document.js';

const time = z.number().nonnegative({ error: 'Use 0 s or later.' }), bus = z.number().int().nonnegative();
const eventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fault_on'), time, bus, R: z.number(), X: z.number() }),
  z.strictObject({ type: z.literal('fault_off'), time, bus }),
  z.strictObject({ type: z.enum(['in_service', 'out_of_service']), time, device: z.string().min(1) }),
]);
export const studySchema = z.strictObject({
  tmax: z.number().positive(), dt_monitor: z.number().positive(), events: z.array(eventSchema).optional(),
  rel_tol: z.number().positive().optional(), abs_tol: z.number().positive().optional(),
  dt_fixed: z.number().nonnegative().optional(), max_steps: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  max_order: z.number().int().min(1).max(5).optional(), consistent_ic_type: z.enum(['y', 'ya_ydp']).optional(),
});
export type Study = z.infer<typeof studySchema>;
export type SimulationEvent = z.infer<typeof eventSchema>;
export type EventType = SimulationEvent['type'];
export const runDefaults = { rel_tol: 1e-5, abs_tol: 1e-5, max_steps: Number.MAX_SAFE_INTEGER } as const;
export const defaultStudy = (): Study => ({ tmax: 10, dt_monitor: 0.01, events: [] });
/** When a scheduled action happens: at 1 s, or two steps in where steps are longer, and never past half the run. */
export const actionTime = (study: Study) => Math.min(Math.max(1, 2 * (study.dt_fixed || study.dt_monitor)), study.tmax / 2);
export const faultable = (row: ElementRecord) => row.ref.collection === 'buses' && row.value.class === 'Bus';
export const switchable = (row: ElementRecord) => row.ref.collection === 'devices' && row.value.class === 'Branch';
export interface StudyIssue { readonly path: readonly (string | number)[]; readonly message: string }
export function studyTargets(document: CaseDocument) {
  return {
    buses: new Map(document.rows('buses').filter(faultable).map(row => [Number(row.value.number), row])),
    branches: new Map(document.rows('devices').filter(switchable).map(row => [String(row.value.id), row])),
  };
}
export type StudyTargets = ReturnType<typeof studyTargets>;

export function studyIssues(value: unknown, targets?: StudyTargets): StudyIssue[] {
  const parsed = studySchema.safeParse(value);
  // A blank required number reads as missing, not as the parser's type complaint.
  if (!parsed.success) return parsed.error.issues.map(issue => ({
    path: issue.path.map(part => typeof part === 'number' ? part : String(part)),
    message: issue.code === 'invalid_type' && /received (null|undefined)$/.test(issue.message) ? 'Enter a value.' : issue.message,
  }));
  const study = parsed.data, issues: StudyIssue[] = [];
  let previous = 0;
  for (const [index, event] of (study.events ?? []).entries()) {
    const add = (field: string, message: string) => issues.push({ path: ['events', index, field], message });
    if (event.time < previous) add('time', 'Events must be ordered by time.');
    if (event.time > study.tmax) add('time', 'Time exceeds the simulation duration.');
    if ('bus' in event && targets && !targets.buses.has(event.bus)) add('bus', 'Choose an existing bus that supports faults.');
    if ('device' in event && targets && !targets.branches.has(event.device)) add('device', 'Choose an existing line.');
    if (event.type === 'fault_on' && event.R === 0 && event.X === 0) add('impedance', 'Resistance and reactance cannot both be zero.');
    previous = event.time;
  }
  if (study.dt_fixed && study.max_order !== undefined && study.max_order > 2)
    issues.push({ path: ['max_order'], message: 'Fixed stepping supports a maximum order of 2. Clear the order to use the solver default.' });
  return issues;
}

export function eventFor(type: EventType, time: number, row?: ElementRecord): SimulationEvent {
  if (type === 'fault_on') return { type, time, bus: Number(row?.value.number ?? 0), R: 0, X: 0.01 };
  if (type === 'fault_off') return { type, time, bus: Number(row?.value.number ?? 0) };
  return { type, time, device: String(row?.value.id ?? '') };
}

/** A context action prepares a new study; it never mutates a running simulation or the case. */
export function withEvent(study: Study, type: EventType, row: ElementRecord): Study {
  const next = structuredClone(study), time = actionTime(next);
  const events = next.events ??= [];
  events.push(eventFor(type, time, row));
  if (type === 'fault_on') events.push(eventFor('fault_off', Math.min(next.tmax, time + 0.15), row));
  events.sort((a, b) => a.time - b.time); // Stable at equal times: preserve explicit event ordering.
  return next;
}

export function importStudy(text: string): Study {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a solver settings object.');
  const { system_model_file: _model, output_file: _output, ...settings } = value as Record<string, unknown>;
  const issues = studyIssues(settings);
  if (issues.length) throw new Error(issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
  return studySchema.parse(settings);
}

