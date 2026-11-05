import { Gpu, type LatkitError, type Source } from 'latkit';
import type { CaseDocument, ElementRecord } from '@gridkit/library';
import type { Diagnostic } from '../domain/views.js';
import { errorMessage } from '../ui/errors.js';
import { latkit } from '../ui/latkit.js';
import { dataset } from './data.js';
import { spaceOf, tablesOf, type NetworkScene } from './scene.js';
import { CaseView } from './view.js';

/** Results covering the network's right and bottom edges, in CSS pixels. */
export interface Dock { readonly right: number; readonly bottom: number }
export const undocked: Dock = { right: 0, bottom: 0 };

const reasons = (error: unknown): string => error instanceof Error
  ? error.cause === undefined ? error.message : `${error.message}: ${reasons(error.cause)}` : String(error);

export interface NetworkSource {
  document(): CaseDocument;
  scene(): NetworkScene;
  rows(): ReadonlyMap<string, readonly ElementRecord[]>;
  extra(): Source[];
  dock(): Dock;
  pitch(): number;
  listen(opened: CaseView): void;
}

/** One lazily opened network view. Hidden canvases retain their camera and draw no frames. */
export class NetworkHost {
  opened = $state.raw<CaseView>();
  ready = $state(false);
  fault = $state('');
  diagnostics = $state.raw<readonly Diagnostic[]>([]);
  stopped = $state(false);
  // Dock changes move no content until the user asks to fit around them.
  #fittedDock = $state.raw<Dock>(undocked);
  #starting = false;
  #settling: CaseView | undefined;
  #failed = false;
  #active = false;
  #disposed = false;
  #generation = 0;
  #recovering = false;
  #canvas: HTMLCanvasElement | undefined;
  // Retry owns a fresh device; the default GPU still belongs to plots and exports.
  #replacement: Gpu | undefined;

  constructor(private source: NetworkSource) {}

  #insets(): [number, number, number, number] {
    const dock = this.#fittedDock;
    return [20, dock.right + 12, Math.max(20, dock.bottom + 12), 12];
  }
  applyInsets() {
    if (!this.stopped && this.opened) this.opened.view.insets = this.#insets();
  }
  /** Fit case marks, never the geography underneath them. */
  framed() {
    const drawn = tablesOf(this.source.scene());
    return [...this.source.rows()].flatMap(([table, rows]) => drawn.has(table) && rows.length ? [[dataset, table] as const] : []);
  }
  fit(): boolean {
    const opened = this.opened, tables = this.framed(), dock = this.source.dock();
    if (!opened || this.stopped || !tables.length) return false;
    if (this.#fittedDock.right !== dock.right || this.#fittedDock.bottom !== dock.bottom) {
      this.#fittedDock = dock;
      opened.view.insets = this.#insets();
    }
    void opened.view.fit({ tables }).catch(error => {
      if (!this.#disposed && this.opened === opened && this.#active) this.#fail(error);
    });
    return true;
  }
  #report() {
    const next = this.opened?.issues ?? [];
    if (JSON.stringify(next) !== JSON.stringify(this.diagnostics)) this.diagnostics = next;
  }
  /** Update visual choices and supplemental data; the case dataset stays fixed. */
  update() {
    const opened = this.opened;
    if (!opened || this.#failed || this.stopped || this.#disposed) return;
    const input = this.source.scene(), before = opened.input;
    opened.draw(this.source.extra());
    try {
      if (opened.show(input) && before && spaceOf(before.scene) !== spaceOf(input.scene)) this.fit();
      this.fault = '';
    } catch (error) { this.fault = errorMessage(error, 'Rendering is unavailable.'); }
  }
  #fail(error: unknown) {
    this.ready = false;
    if ((error as LatkitError)?.code === 'stopped') {
      this.stopped = true;
      this.fault = 'The graphics runtime stopped. Reload the page to draw again.';
      return;
    }
    this.#failed = true;
    const waiting = this.opened?.view.waiting.join(', ');
    this.fault = (error as LatkitError)?.code === 'timeout'
      ? `The graphics view did not finish drawing: ${reasons(error)}${waiting ? ` while waiting on ${waiting}` : ''}. Try again, or open Table to inspect the case.`
      : error instanceof Error ? reasons(error) : errorMessage(error, 'Rendering is unavailable.');
  }
  activate(active: boolean) { this.#active = active; }
  /** Drop stalled shader work and reopen on a fresh device. */
  async retry(canvas: HTMLCanvasElement | undefined) {
    if (this.#recovering || this.stopped || this.#disposed || !canvas) return;
    this.#recovering = true;
    this.#generation++;
    this.#canvas = canvas;
    this.#starting = false;
    this.#settling = undefined;
    this.opened?.destroy();
    this.opened = undefined;
    this.#replacement?.destroy();
    this.#replacement = undefined;
    this.ready = false;
    this.fault = '';
    this.#failed = false;
    this.diagnostics = [];
    try {
      const gpu = await Gpu.create();
      if (this.#disposed || this.stopped) { gpu.destroy(); return; }
      this.#replacement = gpu;
    } catch (error) {
      if (!this.#disposed) this.#fail(error);
      return;
    } finally { this.#recovering = false; }
    if (this.#active) await this.show(this.#canvas);
  }
  async show(canvas: HTMLCanvasElement | undefined) {
    if (canvas) this.#canvas = canvas;
    if (this.opened) { this.#settle(); return; }
    if (this.#disposed || this.#recovering || this.stopped || this.#starting || !canvas) return;
    this.#starting = true;
    const generation = this.#generation;
    const current = () => !this.#disposed && !this.stopped && generation === this.#generation;
    let opened: CaseView | undefined;
    try {
      const gpu = this.#replacement ?? await latkit();
      if (!current()) return;
      opened = new CaseView(this.source.document());
      const pitch = this.source.pitch();
      await opened.open(canvas, this.source.scene(), { gpu, ...pitch ? { camera: { pitch } } : {}, extra: this.source.extra() });
      if (!current()) { opened.destroy(); return; }
      this.#listen(opened);
      this.source.listen(opened);
      opened.view.insets = this.#insets();
      this.opened = opened;
      this.fit();
      this.fault = '';
      this.#report();
      this.#settle();
    } catch (error) {
      opened?.destroy();
      if (current()) this.#fail(error);
    } finally {
      if (generation === this.#generation) this.#starting = false;
    }
  }
  #settle() {
    const opened = this.opened;
    if (!opened || this.#disposed || this.stopped || this.#failed || this.ready || this.#settling) return;
    this.#settling = opened;
    const current = () => !this.#disposed && this.opened === opened && this.#settling === opened;
    opened.view.done().then(() => {
      if (!current()) return;
      this.#settling = undefined;
      if (!this.fault) this.ready = true;
    }, (error: LatkitError) => {
      if (!current()) return;
      this.#settling = undefined;
      // A hidden canvas may time out; showing it starts another wait.
      if (error?.code === 'timeout' && !this.#active) return;
      this.#fail(error);
    });
  }
  #listen(opened: CaseView) {
    opened.view.on('failures', () => { if (this.opened === opened) this.#report(); });
    opened.view.on('error', error => {
      if (!this.#disposed && this.opened === opened) this.#fail(error);
    });
  }
  destroy() {
    this.#disposed = true;
    this.opened?.destroy();
    this.#replacement?.destroy();
  }
}
