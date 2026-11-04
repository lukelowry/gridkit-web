import { tick } from 'svelte';
import { caseReadiness, serializeCase, targetOf, type ElementRecord, type ElementRef, type Model } from '@gridkit/library';
import { entriesOf, entryOf } from '../domain/entries.js';
import { representation, type MappingChanges } from '../domain/views.js';
import type { ElementSubmission } from '../elements/draft.js';
import { errorMessage } from '../ui/errors.js';
import { fileName, save } from '../ui/files.js';
import { isGeographic } from '../rendering/data.js';
import type { ExportRequest } from '../rendering/export.js';
import type { Simulation } from '../simulation/simulation.svelte.js';
import { withEvent, type EventType, type Study } from '@gridkit/library/gridkit';
import type { MenuItem } from '../ui/Menu.svelte';
import { notify } from '../ui/toasts.svelte.js';
import { Dialogs, type Shown } from './dialogs.svelte.js';
import { CaseSession } from './session.svelte.js';

export const elementViews = ['network', 'table'] as const;
export type ElementViewName = (typeof elementViews)[number];
export const views = [...elementViews, 'solver'] as const;
export type ViewName = (typeof views)[number];
export const viewLabels: Record<ViewName, string> = { network: 'Network', table: 'Table', solver: 'Solver' };
export interface SolverRequest { readonly study: Study; readonly initialEvent: number }

export interface WorkspaceOptions {
  readonly simulation: Simulation;
  /** Moves focus into the Table. */
  focusTable(): void;
  /** Opens the Solver view at its heading, without starting text entry. */
  focusSolver(): void;
  /** Moves focus to the page shown with no case open. */
  focusWelcome(): void;
}

/** One open editor: its case, the view on it, what is selected there, and what acts on them. */
export class Workspace {
  readonly caseSession = new CaseSession({ confirmReplace: () => this.mayReplace(), stopRun: () => this.simulation.stop() });
  readonly dialogs = new Dialogs();
  view = $state<ViewName>('table');
  selected = $state<ElementRef | null>(null);
  query = $state('');
  notice = $state('');
  solverPending = $state(false);
  solverVisited = $state(false);
  solverRequest = $state.raw<SolverRequest | null>(null);
  /** Counts cases opened, which rebuild what shows one. */
  session = $state(0);
  menu = $state.raw<{ at: { x: number; y: number }; label: string; groups: MenuItem[][] } | null>(null);
  #options: WorkspaceOptions;

  constructor(options: WorkspaceOptions) { this.#options = options; }

  get simulation() { return this.#options.simulation; }
  get editor() { return this.caseSession.editor; }
  readonly changed = $derived(this.solverPending || this.dialogs.pending.size > 0 || this.caseSession.hasUnsavedChanges);
  readonly interactive = $derived(!this.caseSession.busy && !this.dialogs.shown.length);
  readonly canDelete = $derived(this.view === 'table' && this.interactive && !!this.selected);
  readonly entries = $derived(entriesOf(this.editor.document));
  readonly issues = $derived(caseReadiness(this.editor.document));
  readonly geographic = $derived(isGeographic(this.editor.document));

  open = (dialog: Shown) => { this.menu = null; this.dialogs.open(dialog); };
  openPreferences = (page = 'appearance') => this.open({ kind: 'preferences', page });
  openSolver = (seed?: Study) => {
    if (seed && !this.mayReplaceStudy()) return;
    if (seed) this.solverRequest = { study: seed, initialEvent: Math.max(0, seed.events?.findIndex((event, index) =>
      JSON.stringify(event) !== JSON.stringify(this.caseSession.study.events?.[index])) ?? 0) };
    this.menu = null; this.changeView('solver');
  };
  private mayReplaceStudy() {
    return !this.solverPending || window.confirm('Discard unapplied solver edits?');
  }
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
    if (!this.simulation.available || this.simulation.busy) return false;
    if (next) {
      if (!this.mayReplaceStudy()) return false;
      this.caseSession.updateStudy(next); this.solverRequest = null;
    }
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
    this.choose(ref);
    const entry = this.lookup(ref);
    this.notice = entry ? `${entry.class} ${entry.label} selected.` : '';
  };
  openElement = (ref: ElementRef) => {
    this.choose(ref);
    this.open({ kind: 'element', request: { ref } });
  };
  /** Adds a model, then opens its properties to finish its fields and connections. */
  addModel = (model: Model) => {
    let ref: ElementRef | undefined;
    this.editor.edit(`add ${model.label}`, tx => {
      ref = tx.add(model.id);
    });
    this.query = '';
    if (!ref) return;
    this.openElement(ref);
  };
  changeView = (next: ViewName) => {
    this.view = next;
    if (next === 'solver') { this.solverVisited = true; void this.focusView(); }
  };
  history = (direction: 'undo' | 'redo') => {
    this.editor[direction]();
    if (this.selected && !this.editor.document.get(this.selected)) this.selected = null;
  };
  commitElement = (submission: ElementSubmission) => {
    this.editor.edit(`edit ${this.lookup(submission.ref)?.class ?? 'element'}`, tx => {
      tx.update(submission.ref, submission.changes);
      for (const connection of submission.connections) tx.connect({ element: submission.ref, port: connection.port }, connection.to);
    });
    this.choose(submission.ref);
    this.notice = 'Changes applied.';
  };
  commitMappings = (changes: MappingChanges) => {
    this.editor.edit('case mappings', tx => tx.apply(changes));
    this.notice = 'Mappings applied.';
  };
  focusView = async () => {
    await tick();
    if (this.view === 'table') this.#options.focusTable();
    else if (this.view === 'solver') this.#options.focusSolver();
    else document.querySelector<HTMLCanvasElement>('canvas:not([hidden])')?.focus({ preventScroll: true });
  };
  requestDelete = (ref: ElementRef | null) => {
    if (!ref) return;
    if (this.editor.document.dependents(ref).length) this.open({ kind: 'delete', ref });
    else {
      try { this.deleteElement(ref); }
      catch (cause) { notify(errorMessage(cause, 'Could not delete this element.')); }
    }
  };
  deleteElement = (ref: ElementRef, cascade = false) => {
    this.editor.edit(`delete ${this.lookup(ref)?.class ?? 'element'}`, tx => tx.remove([ref], { connected: cascade ? 'cascade' : 'reject' }));
    if (this.selected && !this.editor.document.get(this.selected)) this.selected = null;
    this.dialogs.close('element', 'delete');
    this.notice = 'Element deleted. Undo restores it.';
    void this.focusView();
  };

  mayReplace(): boolean {
    if (this.dialogs.showing('home')) return true;
    if (this.simulation.busy && !window.confirm('Close the running study? This requests cancellation and removes its results from this session.')) return false;
    return !this.changed || window.confirm('Discard case or solver settings changes you have not downloaded?');
  }
  #reset(next: ViewName) {
    this.dialogs.clear();
    this.selected = null;
    this.solverPending = false; this.solverVisited = false; this.solverRequest = null;
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
  /** Saves the case as it is now; it counts as exported once the file is written. */
  downloadCaseFile = async () => {
    try {
      const snapshot = this.editor.snapshot(), value = snapshot.value;
      if (!await save(`${fileName(value.header.case_name)}.case.json`, serializeCase(value))) return;
      this.editor.markExported(snapshot);
      this.notice = 'Case downloaded.';
    } catch (cause) {
      notify(errorMessage(cause, 'Could not download the case.'));
    }
  };
}
