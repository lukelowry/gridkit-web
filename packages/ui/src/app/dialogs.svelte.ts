import { SvelteSet } from 'svelte/reactivity';
import type { ElementRef } from '@gridkit/library';
import type { ExportRequest } from '../rendering/export.js';

/** What a dialog over the workspace shows. */
export type Shown = { kind: 'preferences'; page: string } | { kind: 'case' } | { kind: 'issues' } | { kind: 'library' }
  | { kind: 'element'; ref: ElementRef }
  /** An export of what a view shows, saved as `name` and its format's extension. */
  | { kind: 'export'; request: ExportRequest; name: string };

/** The dialogs over the workspace. The last dialog is on top. */
export class Dialogs {
  shown = $state.raw<Shown[]>([]);
  /** Dialogs holding edits not yet applied. */
  readonly pending = new SvelteSet<Shown>();
  showing = (kind: Shown['kind']) => this.shown.some(dialog => dialog.kind === kind);
  open(dialog: Shown) { this.shown = [...this.shown, dialog]; }
  close = (...kinds: Shown['kind'][]) => {
    for (const dialog of this.shown) if (kinds.includes(dialog.kind)) this.pending.delete(dialog);
    this.shown = this.shown.filter(dialog => !kinds.includes(dialog.kind));
  };
  clear() { this.shown = []; this.pending.clear(); }
}
