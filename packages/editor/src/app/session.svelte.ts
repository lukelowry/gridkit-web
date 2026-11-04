import { parseCase } from '@gridkit/library';
import { defaultStudy, studySchema, type Study } from '@gridkit/library/gridkit';
import { createEditor } from './case-editor.svelte.js';

interface SessionOptions {
  confirmReplace(): boolean;
  stopRun(): Promise<void>;
}

/** Owns the open case and study in memory; files are saved only by explicit export. */
export class CaseSession {
  #editor = $state.raw(createEditor());
  #study = $state.raw<Study>(defaultStudy());
  #savedStudy = $state(JSON.stringify(defaultStudy()));
  opened = $state(false);
  busy = $state(false);

  constructor(private options: SessionOptions) {}
  get editor() { return this.#editor; }
  get study() { return this.#study; }
  get hasUnsavedChanges() { return this.#editor.changed || JSON.stringify(this.#study) !== this.#savedStudy; }

  updateStudy(study: Study) { this.#study = studySchema.parse(study); }
  markStudyExported(study: Study) { this.#savedStudy = JSON.stringify(studySchema.parse(study)); }

  async open(file: File) {
    if (this.busy) return false;
    this.busy = true;
    try {
      const editor = createEditor(parseCase(await file.text()));
      if (!this.options.confirmReplace()) return false;
      await this.options.stopRun();
      this.#editor = editor;
      this.#study = defaultStudy(); this.#savedStudy = JSON.stringify(this.#study);
      this.opened = true;
      return true;
    } finally { this.busy = false; }
  }

  async close() {
    if (this.busy || !this.options.confirmReplace()) return false;
    this.busy = true;
    try {
      await this.options.stopRun();
      this.#editor = createEditor();
      this.#study = defaultStudy(); this.#savedStudy = JSON.stringify(this.#study);
      this.opened = false;
      return true;
    } finally { this.busy = false; }
  }
}
