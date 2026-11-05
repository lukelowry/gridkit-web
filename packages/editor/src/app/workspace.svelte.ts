import { tick } from 'svelte';
import { caseReadiness, serializeCase, targetOf, type ElementRecord, type ElementRef } from '@gridkit/library';
import { entriesOf, entryOf, sameReference } from '../domain/entries.js';
import { representation } from '../domain/views.js';
import { errorMessage } from '../ui/errors.js';
import { fileName, save } from '../ui/files.js';
import { isGeographic } from '../rendering/data.js';
import type { ExportRequest } from '../rendering/export.js';
import type { Simulation } from '../simulation/simulation.svelte.js';
import { withEvent, type EventType, type Study } from '@gridkit/library/gridkit';
import type { MenuItem } from '../ui/menu.js';
import { notify } from '../ui/toasts.svelte.js';
import { Dialogs, type Shown } from './dialogs.svelte.js';
import { CaseSession } from './session.svelte.js';

export const elementViews = ['network', 'table'] as const;
export type ElementViewName = (typeof elementViews)[number];
export const views = [...elementViews, 'solver'] as const;
export type ViewName = (typeof views)[number];
export const viewLabels: Record<ViewName, string> = { network: 'Network', table: 'Table', solver: 'Solver' };

export interface WorkspaceOptions {
  readonly simulation: Simulation;
  /** Moves focus into the Table. */
  focusTable(): void;
  /** Opens the Solver view at its form, without starting text entry. */
  focusSolver(): void;
  /** Moves focus to the page shown with no case open. */
  focusWelcome(): void;
  solverInvalid(): boolean;
}

/** One open editor: its case, the view on it, what is selected there, and what acts on them. */
export class Workspace {
  readonly caseSession = new CaseSession({ confirmReplace: () => this.mayReplace(), stopRun: () => this.simulation.stop() });
  readonly dialogs = new Dialogs();
  view = $state<ViewName>('table');
  selected = $state<ElementRef | null>(null);
  hovered = $state.raw<ElementRef | null>(null);
  #hoverSource: 'network' | 'plot' | null = null;
  hover = (source: 'network' | 'plot', ref: ElementRef | null) => {
    if (ref && this.editor.document.get(ref)) { this.#hoverSource = source; if (!sameReference(this.hovered, ref)) this.hovered = ref; }
    else if (this.#hoverSource === source) { this.#hoverSource = null; this.hovered = null; }
  };
  query = $state('');
  notice = $state('');
  solverVisited = $state(false);
  /** Counts cases opened, which rebuild what shows one. */
  session = $state(0);
  menu = $state.raw<{ at: { x: number; y: number }; label: string; groups: MenuItem[][] } | null>(null);
  #options: WorkspaceOptions;

  constructor(options: WorkspaceOptions) { this.#options = options; }

  get solverInvalid() { return this.#options.solverInvalid(); }
  get simulation() { return this.#options.simulation; }
  get editor() { return this.caseSession.editor; }
  readonly changed = $derived(this.dialogs.pending.size > 0);
  readonly interactive = $derived(!this.caseSession.busy && !this.dialogs.shown.length);
  readonly entries = $derived(entriesOf(this.editor.document));
  readonly issues = $derived(caseReadiness(this.editor.document));
  readonly geographic = $derived(isGeographic(this.editor.document));

  open = (dialog: Shown) => { this.menu = null; this.dialogs.open(dialog); };
  openPreferences = (page = 'appearance') => this.open({ kind: 'preferences', page });
  openSolver = (seed?: Study) => {
    if (seed) this.caseSession.updateStudy(seed);
    this.menu = null; this.changeView('solver');
  };
  /** Opens Export on what a view shows, `subject` naming it, saved under the case's name. */
  openExport = (request: ExportRequest, subject: string) =>
    this.open({ kind: 'export', request, name: `${this.editor.info.header.case_name || 'Untitled'} ${subject}` });
  /** One element's entry, read from the document: interaction lookups never build the whole table. */
  lookup = (ref: ElementRef | null) => { const row = ref && this.editor.document.get(ref); return row ? entryOf(this.editor.document, row) : undefined; };
  /**
   * The study for `type` at `row` alone: it keeps the study's timing and integration, and its events become this action (a fault
   * with its clearing), never adding to the events an earlier run used.
   */
  actionStudy(type: EventType, row: ElementRecord) { return withEvent({ ...$state.snapshot(this.caseSession.study), events: [] }, type, row); }
  /** Runs the study as Solver holds it. */
  runStudy = (next?: Study) => {
    if (!this.simulation.available || this.simulation.busy || this.solverInvalid) return false;
    if (next) this.caseSession.updateStudy(next);
    this.simulation.start(this.editor.document, this.editor.caseVersion, this.caseSession.study);
    return true;
  };

  /** Selects an element, using Table when the network cannot draw it. */
  choose = (ref: ElementRef | null) => {
    const row = ref && this.editor.document.get(ref);
    this.selected = row ? row.ref : null;
    if (!row) return;
    if (this.view === 'network' && !representation(targetOf(row))) this.view = 'table';
  };
  /** The canvas shows its selection visually; the status announces it. */
  chooseOnCanvas = (ref: ElementRef | null) => {
    const entry = this.lookup(ref);
    this.selected = entry ? ref : null;
    this.notice = entry ? `${entry.class} ${entry.label} selected.` : '';
  };
  openElement = (ref: ElementRef) => {
    this.choose(ref);
    this.open({ kind: 'element', ref });
  };
  changeView = (next: ViewName) => {
    this.view = next;
    if (next === 'solver') { this.solverVisited = true; void this.focusView(); }
  };
  focusView = async () => {
    await tick();
    if (this.view === 'table') this.#options.focusTable();
    else if (this.view === 'solver') this.#options.focusSolver();
    else document.querySelector<HTMLCanvasElement>('canvas:not([hidden])')?.focus({ preventScroll: true });
  };

  mayReplace(): boolean {
    if (this.simulation.busy && !window.confirm('Close the running study? This requests cancellation and removes its results from this session.')) return false;
    return !this.changed || window.confirm('Discard settings changes?');
  }
  #reset(next: ViewName) {
    this.dialogs.clear();
    this.selected = null; this.hovered = null; this.#hoverSource = null;
    this.solverVisited = false;
    this.query = '';
    this.session++;
    this.view = next;
    this.notice = '';
  }
  closeCase = async () => {
    try {
      if (!await this.caseSession.close()) return;
      this.#reset('table'); this.notice = 'Case closed.';
      await tick(); this.#options.focusWelcome();
    } catch (cause) { notify(errorMessage(cause)); }
  };
  openFile = async (file: File) => {
    try {
      if (!await this.caseSession.open(file)) return;
      this.#reset(this.editor.document.size ? 'network' : 'table');
      this.notice = 'Case opened.';
    } catch (cause) { notify(errorMessage(cause, 'Could not open the case.')); }
  };
  download = () => {
    if (this.issues.length) { this.dialogs.close('case'); this.open({ kind: 'issues' }); }
    else void this.downloadCaseFile();
  };
  /** Downloads the opened case without changing it. */
  downloadCaseFile = async () => {
    try {
      const snapshot = this.editor.snapshot(), value = snapshot.value;
      if (!await save(`${fileName(value.header.case_name)}.case.json`, serializeCase(value))) return;
      this.notice = 'Case downloaded.';
    } catch (cause) {
      notify(errorMessage(cause, 'Could not download the case.'));
    }
  };
}
