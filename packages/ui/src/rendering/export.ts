import { Shot, View, type Camera, type ImageFormat, type Placed, type Rect, type Scene, type TableInput } from 'latkit';
import { write } from '../ui/files.js';
import type { RunSession } from '../simulation/run.svelte.js';
import { themeOf } from './scene.js';
import type { Dock } from './network-host.svelte.js';

/** The canvases shown when Export opens. Page controls are omitted from the file. */
export interface ExportRequest {
  readonly view: View;
  readonly canvas: readonly [width: number, height: number];
  readonly tables?: readonly TableInput[] | undefined;
  readonly run?: Pick<RunSession, 'playhead' | 'range' | 'live' | 'seek' | 'follow'> | undefined;
  readonly plot?: { readonly view: View; readonly dock: Dock } | undefined;
}
export interface PictureSize { readonly layout: readonly [width: number, height: number]; readonly ratio: number }
export interface Drawing {
  readonly size: PictureSize;
  readonly framing: 'shown' | 'fit';
  readonly text: number;
}
/** A video preview and the corresponding recorded frame use the same time, turn, and plot bounds. */
export interface ExportFrame { readonly at: number; readonly turn: number; readonly span: readonly [number, number] }
export const pixelsOf = ({ layout, ratio }: PictureSize) => [Math.max(1, Math.round(layout[0] * ratio)), Math.max(1, Math.round(layout[1] * ratio))] as const;
/** The encoder's alignment applies to the preview and the written video alike. */
export function videoSize(size: PictureSize): PictureSize {
  const [width, height] = pixelsOf(size);
  return { layout: [Math.max(4, width - width % 4) / size.ratio, Math.max(2, height - height % 2) / size.ratio], ratio: size.ratio };
}
export const heightFor = (request: ExportRequest, width: number) => width * request.canvas[1] / request.canvas[0];

/** One composition for images, video previews, and video. Preserve the dock side and its share. */
export function composition(request: ExportRequest, drawing: Drawing) {
  const [width, height] = pixelsOf(drawing.size), [sourceWidth, sourceHeight] = request.canvas;
  const scale = drawing.framing === 'shown' ? Math.min(width / sourceWidth, height / sourceHeight) : drawing.size.ratio;
  const shown = drawing.framing === 'shown';
  const w = shown ? sourceWidth * scale / width : 1, h = shown ? sourceHeight * scale / height : 1;
  const x = (1 - w) / 2, y = (1 - h) / 2;
  let main: Rect = [x, y, w, h];
  const dock = request.plot?.dock;
  let plot: Rect | undefined;
  if (dock?.right) {
    const share = Math.min(.95, dock.right / sourceWidth);
    plot = [x + w * (1 - share), y, w * share, h];
    if (!shown) main = [x, y, w * (1 - share), h];
  } else if (dock?.bottom) {
    const share = Math.min(.95, dock.bottom / sourceHeight);
    plot = [x, y + h * (1 - share), w, h * share];
    if (!shown) main = [x, y, w, h * (1 - share)];
  }
  return { scale, main, plot };
}

// Preview, Copy and Save can overlap. Serialize access to the live view and restore it before the next job starts.
const pending = new WeakMap<View, Promise<void>>();
function queued<T>(view: View, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  const task = (pending.get(view) ?? Promise.resolve()).then(() => { signal?.throwIfAborted(); return work(); });
  const settled = task.then(() => {}, () => {});
  pending.set(view, settled);
  void settled.then(() => { if (pending.get(view) === settled) pending.delete(view); });
  return task;
}
function pictureScene(scene: Scene, text: number): Scene {
  const theme = themeOf(scene), size = theme?.text?.size;
  return { ...scene, ease: 0, controls: { hover: false, motion: 'full' },
    ...theme && { theme: { ...theme, ...size !== undefined && { text: { ...theme.text, size: size * text } } } } };
}

/** Borrow the drawn network for As shown: this retains its actual layout, camera, insets, and selection.
 * Fit all owns a separate view. A plot has no graph layout and is cloned onto the network's GPU, including after recovery. */
async function pictureViews(request: ExportRequest, drawing: Drawing, frame: ExportFrame | undefined, signal?: AbortSignal) {
  const live = request.view, owned: View[] = [];
  const original = { scene: live.scene, camera: live.camera, insets: live.insets, orbit: live.orbit, at: live.at };
  const run = request.run, following = run?.live, time = run?.playhead.time, playing = run?.playhead.playing;
  const layout = composition(request, drawing);
  let borrowed = false;
  const close = () => {
    for (const view of owned) view.destroy();
    if (borrowed) { live.scene = original.scene; live.camera = original.camera; live.insets = original.insets; live.orbit = original.orbit; live.at = original.at; }
    if (run && time !== undefined) { if (following) run.follow(); else { run.seek(time); if (playing) run.playhead.play(); } }
  };
  try {
    if (run) run.seek(frame?.at ?? time!);
    const scene = pictureScene(original.scene, drawing.text), fit = drawing.framing === 'fit' && !!request.tables?.length;
    let main: View;
    if (fit) {
      const camera = original.camera;
      main = await View.create(null, scene, { sources: live.sources, gpu: live.gpu,
        ...'zoom' in camera && { camera: { pitch: camera.pitch, bearing: camera.bearing } }, ...signal && { signal } });
      owned.push(main);
      main.selection = live.selection;
      void main.fit({ tables: [...request.tables!] });
    } else {
      main = live; borrowed = true;
      main.scene = scene; main.orbit = 0;
    }
    main.at = frame?.at ?? original.at;
    const camera = main.camera;
    if (frame?.turn && 'bearing' in camera) main.camera = { bearing: camera.bearing + frame.turn };
    const placed: Placed[] = [{ view: main, region: layout.main }];
    if (request.plot && layout.plot) {
      const source = request.plot.view;
      const camera: Camera = drawing.framing === 'fit' && frame ? { x: [...frame.span], y: null } : source.camera;
      const traces = await View.create(null, pictureScene(source.scene, drawing.text), { sources: source.sources, gpu: live.gpu, camera, ...signal && { signal } });
      owned.push(traces); traces.at = main.at; traces.insets = source.insets; traces.selection = source.selection;
      placed.push({ view: traces, region: layout.plot });
    }
    return { main, views: [main, ...owned.filter(view => view !== main)], placed, scale: layout.scale, close };
  } catch (cause) { close(); throw cause; }
}

export function picture(request: ExportRequest, output: WritableStream<Uint8Array>, { format, transparent = false, quality, signal, frame, ...drawing }: Drawing & {
  format: ImageFormat; transparent?: boolean; quality?: number; signal?: AbortSignal; frame?: ExportFrame | undefined;
}): Promise<void> {
  return queued(request.view, signal, async () => {
    const made = await pictureViews(request, drawing, frame, signal), wait = signal ? { signal } : {};
    let bytes: Uint8Array;
    try {
      const image = await new Shot(pixelsOf(drawing.size), { scale: made.scale, capture: 'now', transparent: transparent && format !== 'jpeg', views: made.placed }).image(wait);
      try { bytes = await image.encode(format, { ...quality === undefined ? {} : { quality }, ...wait }); }
      finally { image.destroy(); }
    } finally { made.close(); }
    await write(output, bytes);
  });
}

export function video(request: ExportRequest & { readonly run: NonNullable<ExportRequest['run']> }, output: WritableStream<Uint8Array>,
  { fps, from, to, speed, orbit = 0, bitrate, signal, progress, ...drawing }: Drawing & {
    fps: number; from: number; to: number; speed: number; orbit?: number; bitrate?: number; signal?: AbortSignal; progress?: (done: number) => void;
  }): Promise<void> {
  return queued(request.view, signal, async () => {
    if (!(to > from) || !(speed > 0)) throw new RangeError('End must be after start and speed must be above zero.');
    const options = { ...drawing, size: videoSize(drawing.size) };
    const made = await pictureViews(request, options, { at: from, turn: 0, span: [from, to] }, signal);
    const detach = made.views.filter(view => !request.run.playhead.views.has(view)).map(view => request.run.playhead.attach(view));
    const camera = made.main.camera, length = (to - from) / speed;
    try {
      const recording = new Shot(pixelsOf(options.size), { scale: made.scale, views: made.placed })
        .video({ fps, output, ...bitrate === undefined ? {} : { bitrate }, ...signal && { signal } });
      await recording.record(time => {
        if (time > length) return false;
        request.run.seek(Math.min(to, from + time * speed));
        if (orbit && 'bearing' in camera) made.main.camera = { bearing: camera.bearing + orbit * time };
        return true;
      }, progress && (({ time }) => progress(Math.min(1, time / length))));
    } finally { for (const off of detach) off(); made.close(); }
  });
}
