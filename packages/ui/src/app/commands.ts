import { targetOf, type ElementRef } from '@gridkit/library';
import { representation } from '../domain/views.js';
import { eventActions } from '../simulation/solver-fields.js';
import { faultable, switchable, type EventType } from '@gridkit/library/gridkit';
import type { MenuItem } from '../ui/menu.js';
import { matchesShortcut, shortcutHint } from './shortcuts.js';
import { viewLabels, elementViews, type ElementViewName, type Workspace } from './workspace.svelte.js';

/** Opens Solver with `type` at `ref` as the study's action, to set up more than its defaults. */
function scheduleEvent(workspace: Workspace, ref: ElementRef, type: EventType) {
  const row = workspace.current.document.get(ref);
  if (!row) return;
  workspace.openSolver(workspace.actionStudy(type, row));
}
/** Runs `type` at `ref` alone, so Solver shows what ran. */
function simulateNow(workspace: Workspace, ref: ElementRef, type: EventType) {
  const row = workspace.current.document.get(ref), { simulation } = workspace;
  if (!row || !simulation.available || simulation.busy) return;
  const study = workspace.actionStudy(type, row);
  if (workspace.runStudy(study)) { workspace.selected = null; workspace.notice = 'Simulation started.'; }
}
/** An element's simulation commands: its action at once, with Solver's defaults, or seeded in Solver for more. */
const simulationCommands = (workspace: Workspace, ref: ElementRef, type: 'fault_on' | 'out_of_service'): MenuItem[] => [
  { label: type === 'fault_on' ? 'Simulate fault' : 'Simulate line opening', icon: eventActions[type].icon,
    disabled: !workspace.simulation.available || workspace.simulation.busy || workspace.solverInvalid, run: () => simulateNow(workspace, ref, type) },
  { label: 'More…', icon: 'solver', run: () => scheduleEvent(workspace, ref, type) },
];

/** Element commands share the same property, navigation, and simulation actions as the dialogs. */
function commandsOf(workspace: Workspace, ref: ElementRef, from: ElementViewName): MenuItem[][] {
  const row = workspace.current.document.get(ref)!;
  const draws = { network: representation(targetOf(row)), table: true };
  return [
    [{ label: 'Properties', icon: 'settings', keys: shortcutHint('open'), run: () => workspace.openElement(ref) }],
    faultable(row) ? simulationCommands(workspace, ref, 'fault_on') : switchable(row) ? simulationCommands(workspace, ref, 'out_of_service') : [],
    elementViews.filter(other => other !== from && draws[other]).map(other => ({ label: `Show in ${viewLabels[other]}`, icon: other, run: () => { workspace.choose(ref); workspace.changeView(other); } })),
  ];
}

/** Selects what a menu is about, as a click would, and offers its commands; a menu about nothing offers the view's own. */
export function openMenu(workspace: Workspace, ref: ElementRef | null, at: { x: number; y: number }, from: ElementViewName, local: MenuItem[] = []) {
  if (!workspace.interactive) return;
  if (from === 'table') workspace.choose(ref);
  else workspace.chooseOnCanvas(ref);
  const entry = workspace.lookup(workspace.selected), groups = entry ? commandsOf(workspace, entry, from) : [local];
  if (groups.some(group => group.length)) workspace.menu = { at, label: entry ? `${entry.class} ${entry.label}` : viewLabels[from], groups };
}

/** Keys that act on the workspace rather than on a control. */
export function shortcutKey(workspace: Workspace, event: KeyboardEvent) {
  if (workspace.view === 'solver') return;
  if (!workspace.caseSession.opened || !workspace.interactive || event.defaultPrevented || event.isComposing || document.querySelector('[popover="auto"]:popover-open')) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) return;
  if (!(target instanceof Element) || !target.closest('.view-pane:not([hidden])') || event.repeat) return;
  if (matchesShortcut(event, 'cancel')) {
    if (target instanceof HTMLCanvasElement) return;
    event.preventDefault(); event.stopPropagation();
    workspace.choose(null);
    void workspace.focusView();
  } else if (matchesShortcut(event, 'open') && target instanceof HTMLCanvasElement) {
    event.preventDefault(); event.stopPropagation();
    if (workspace.selected) workspace.openElement(workspace.selected);
  }
}
