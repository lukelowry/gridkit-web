import { CaseDocument, createCase, type Case, type ChangeSet, type ElementRef } from '@gridkit/library';
import { editCase, type CaseTransaction } from '../domain/views.js';
import { Notifier } from './notifier.svelte.js';

const HISTORY_LIMIT = 50;
interface Revision { readonly session: object; readonly state: object }
export interface ExportSnapshot extends Revision { readonly value: Case }
interface HistoryEntry { readonly label: string; readonly changes: ChangeSet; readonly before: Revision; readonly after: Revision }

/** What the editor's views read: each read is tracked, and each change tells them to read again. */
const tracked = () => new Notifier();

export function createEditor(value: Case = createCase()) {
  let document = $state.raw(new CaseDocument(value, tracked));
  const initial: Revision = { session: {}, state: {} };
  let revision = $state.raw(initial);
  let checkpoint = $state.raw<Revision>(initial);
  let history: HistoryEntry[] = [];
  let cursor = $state(0);
  let length = $state(0);
  let caseVersion = $state(0);

  // Which case's content a run's results belong to; what reads the document follows it on its own.
  function publish(changes: ChangeSet) {
    if (changes.elements.length) caseVersion++;
  }
  function replace(value: Case) {
    const next = new CaseDocument(value, tracked);
    document = next;
    revision = { session: {}, state: {} };
    checkpoint = revision;
    history = [];
    cursor = length = 0;
    caseVersion++;
  }

  return {
    get document() { return document; },
    get info() { return document.info; },
    get changed() { return revision.state !== checkpoint.state; },
    get canUndo() { return cursor > 0; },
    get canRedo() { return cursor < length; },
    get undoLabel() { revision; return cursor ? history[cursor - 1]!.label : ''; },
    get redoLabel() { revision; return cursor < length ? history[cursor]!.label : ''; },
    get caseVersion() { return caseVersion; },
    get views() { return document.views; },
    get(ref: ElementRef) { return document.get(ref); },

    edit(label: string, build: (tx: CaseTransaction) => void) {
      const changes = editCase(document, build);
      if (!changes) return null;
      const next = { session: revision.session, state: {} };
      history.splice(cursor);
      history.push({ label, changes, before: revision, after: next });
      if (history.length > HISTORY_LIMIT) history.shift();
      cursor = length = history.length;
      revision = next;
      publish(changes);
      return changes;
    },
    undo() {
      if (!cursor) return;
      const entry = history[cursor - 1]!;
      document.apply(entry.changes, 'backward');
      cursor--;
      revision = entry.before;
      publish(entry.changes);
    },
    redo() {
      if (cursor === length) return;
      const entry = history[cursor]!;
      document.apply(entry.changes);
      cursor++;
      revision = entry.after;
      publish(entry.changes);
    },
    open(value: Case) { replace(value); },
    snapshot(): ExportSnapshot { return { ...revision, value: document.export() }; },
    markExported(snapshot: ExportSnapshot) {
      if (snapshot.session === revision.session) checkpoint = snapshot;
    },
  };
}
export type Editor = ReturnType<typeof createEditor>;
