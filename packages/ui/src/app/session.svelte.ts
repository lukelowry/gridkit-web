import { parseCase, readSavedViews, type SavedViews } from '@gridkit/library';
import { defaultStudy, type Study } from '@gridkit/library/gridkit';
import { openCase } from './open-case.svelte.js';
import { json } from '../domain/views.js';

interface SessionOptions {
  confirmReplace(): boolean;
  stopRun(): Promise<void>;
}

/** Owns the open case and study in memory; files are saved only by explicit export. */
export class CaseSession {
  #current = $state.raw(openCase());
  #study = $state<Study>(defaultStudy());
  #mappings = $state.raw<SavedViews>({});
  opened = $state(false);
  busy = $state(false);

  constructor(private options: SessionOptions) {}
  get current() { return this.#current; }
  get study() { return this.#study; }
  get mappings() { return this.#mappings; }
  /** Visual choices belong to this open view; the source case and its exports stay unchanged. */
  updateMappings(value: SavedViews) { this.#mappings = readSavedViews(json(value)); }

  updateStudy(study: Study) { this.#study = study; }

  async open(file: File) {
    if (this.busy) return false;
    this.busy = true;
    try {
      const opened = openCase(parseCase(await file.text()));
      if (!this.options.confirmReplace()) return false;
      await this.options.stopRun();
      this.#current = opened;
      this.#mappings = opened.document.views;
      this.#study = defaultStudy();
      this.opened = true;
      return true;
    } finally { this.busy = false; }
  }

  async close() {
    if (this.busy) return false;
    this.busy = true;
    try {
      await this.options.stopRun();
      this.#current = openCase();
      this.#mappings = {};
      this.#study = defaultStudy();
      this.opened = false;
      return true;
    } finally { this.busy = false; }
  }
}
