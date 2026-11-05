/**
 * @gridkit/library/gridkit: a case as GridKit's DynamicSimulation runs it. A study says how long, how finely, and what happens
 * when; compile turns a case and a study into what GridKit reads, and names the column each element's outputs are recorded in.
 */
import type { ElementRef } from '../index.js';
import type { Study } from './study.js';

// The study: GridKit's solver settings and the events it plays.
export { actionTime, defaultStudy, runDefaults, eventFor, faultable, importStudy, studyIssues, studySchema, studyTargets, switchable, withEvent } from './study.js';
export type { EventType, SimulationEvent, Study, StudyIssue, StudyTargets } from './study.js';

// What GridKit reads, and what it records of each element.
export { compile } from './compile.js';
export { recordedOutputs } from './channels.js';

/** One output of one element, and the column GridKit records it in. */
export interface Channel {
  readonly column: string;
  readonly element: ElementRef;
  readonly output: string;
  readonly label: string;
  readonly unit: string;
  readonly class?: string | undefined;
}

/** What a run hands GridKit, fixed when it is asked for, and the element each recorded column belongs to. */
export interface Compiled { readonly study: Study; readonly model: Blob; readonly channels: readonly Channel[] }
