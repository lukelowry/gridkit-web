import { CaseDocument, createCase, type Case } from '@gridkit/library';

let nextVersion = 0;
/** An opened case has no editing or history state; solver settings belong to its session. */
export function createEditor(value: Case = createCase()) {
  const document = new CaseDocument(value);
  return { document, get info() { return document.info; },
    caseVersion: nextVersion++, snapshot() { return { value: document.export() }; } };
}
