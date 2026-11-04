import { Data, Patch, View, type Camera, type Gpu, type Source } from 'latkit';
import type { CaseDocument, ElementRecord } from '@gridkit/library';
import type { Diagnostic } from '../domain/views.js';
import { dataset, tableColumns, writeChanges, type Written } from './data.js';
import { failuresOf, type NetworkScene } from './scene.js';

/**
 * One latkit view of the case: the dataset it draws, written only where the case changed, and the scene it shows, which latkit
 * draws as far as it can. The editor's views and the renderer tests draw through it alike.
 */
export class CaseView {
  readonly data = new Data(dataset);
  #view: View | undefined;
  #written: Written = new Map();
  #extra: readonly Source[] = [];
  #input: NetworkScene | undefined;
  #json = '';

  get view(): View { return this.#view!; }
  /** The scene last asked for. */
  get input() { return this.#input; }
  /** The mappings latkit draws as if unset, until it can read them and their data fits. */
  get issues(): Diagnostic[] { return this.#input ? failuresOf(this.#input, this.view.failures) : []; }

  /** Writes what `tables` changes since the last write. */
  sync(document: CaseDocument, tables: ReadonlyMap<string, readonly ElementRecord[]>): void {
    const patch = new Patch(), changed = writeChanges(patch, this.#written, tables, table => tableColumns(document, table));
    if (changed) this.data.apply(patch);
  }

  /** Opens the view on `canvas` with `input`, which it compiles against the data written so far, and `extra` datasets. */
  async open(canvas: HTMLCanvasElement | null, input: NetworkScene, { camera, extra = [], signal, gpu }: { camera?: Partial<Camera>; extra?: readonly Source[]; signal?: AbortSignal; gpu?: Gpu } = {}) {
    this.#view = await View.create(canvas, input.scene, { sources: [this.data, ...extra], ...camera && { camera }, ...signal && { signal }, ...gpu && { gpu } });
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
    this.data.destroy();
  }
}
