import { Data, Patch, View, type Camera, type Source } from 'latkit';
import type { CaseDocument } from '@gridkit/library';
import type { Diagnostic } from '../domain/views.js';
import { dataset, tableColumns, tables, writeRows } from './data.js';
import { failuresOf, type NetworkScene } from './scene.js';
import { Pace } from '../ui/pace.js';

/** One immutable case dataset and its independently configurable view. */
export class CaseView {
  readonly data: Data;
  #view: View | undefined;
  #extra: readonly Source[] = [];
  #input: NetworkScene | undefined;
  #json = '';
  #document: CaseDocument | undefined;

  get view(): View { return this.#view!; }
  /** The scene last asked for. */
  get input() { return this.#input; }
  /** The mappings latkit draws as if unset, until it can read them and their data fits. */
  get issues(): Diagnostic[] { return this.#input ? failuresOf(this.#input, this.view.failures) : []; }

  constructor(document: CaseDocument) {
    this.#document = document;
    this.data = new Data(dataset);
  }

  async #prepare(signal: AbortSignal) {
    const document = this.#document;
    if (!document) return;
    const pace = new Pace();
    for (const [table, rows] of tables(document)) {
      const columns = tableColumns(document, table);
      for (let offset = 0; offset < Math.max(1, rows.length); offset += 1024) {
        await pace.ready(signal);
        pace.spend(() => {
          const patch = new Patch();
          writeRows(patch, table, columns, rows.slice(offset, offset + 1024), offset ? 'set' : 'replace');
          this.data.apply(patch);
        });
      }
    }
    this.#document = undefined;
  }

  /** Opens the view on `canvas` with `input`, which it compiles against the case data and `extra` datasets. */
  async open(canvas: HTMLCanvasElement | null, input: NetworkScene, { camera, extra = [], signal }: { camera?: Partial<Camera>; extra?: readonly Source[]; signal?: AbortSignal } = {}) {
    await this.#prepare(signal ?? new AbortController().signal);
    this.#view = await View.create(canvas, input.scene, { sources: [this.data, ...extra], ...camera && { camera }, ...signal && { signal } });
    this.#extra = extra; this.#input = input; this.#json = JSON.stringify(input.scene);
  }

  /** Draws `extra` datasets besides the case's, such as borders and samples, from the frame after they change. */
  draw(extra: readonly Source[]) {
    if (extra.length === this.#extra.length && extra.every((source, index) => source === this.#extra[index])) return;
    this.#extra = extra;
    this.view.sources = [this.data, ...extra];
  }

  /** Shows `input` unless it is the scene already shown; answers whether it changed. */
  show(input: NetworkScene): boolean {
    if (input === this.#input) return false;
    const json = JSON.stringify(input.scene), changed = json !== this.#json;
    if (changed) this.view.scene = input.scene;
    this.#input = input; this.#json = json;
    return changed;
  }

  destroy() {
    this.#view?.destroy();
    this.#document = undefined;
    this.data.destroy();
  }
}
