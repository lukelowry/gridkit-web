import { Shot, View, type Camera, type Controls, type ImageFormat, type Placed, type Scene, type TableInput } from 'latkit';
import { write } from '../ui/files.js';
import type { RunSession } from '../simulation/run.svelte.js';
import { spaceOf, themeOf } from './scene.js';
import type { Dock } from './network-host.svelte.js';

/** What an export draws, as it shows now. */
export interface ExportRequest {
  /** The view shown. */
  readonly view: View;
  /** Its canvas, `[width, height]` in CSS pixels. */
  readonly canvas: readonly [width: number, height: number];
  /** What fitting a picture frames: every row of these tables. */
  readonly tables?: readonly TableInput[] | undefined;
  /** The run whose time the view shows, which a video moves through. */
  readonly run?: Pick<RunSession, 'playhead' | 'range' | 'live' | 'seek' | 'follow'> | undefined;
  /** The plot of the run's time, which the page lays over the view, covering `dock` of it: an export draws it under the view. */
  readonly plot?: { readonly view: View; readonly dock: Dock } | undefined;
}

/** A picture's size: laid out over `layout` CSS pixels, as the screen or page it is for shows it, and drawn at `ratio` pixels per CSS pixel. */
export interface PictureSize { readonly layout: readonly [width: number, height: number]; readonly ratio: number }

/** How a picture is drawn, whatever its file. */
export interface Drawing {
  readonly size: PictureSize;
  /** `shown` keeps all the view shows in view, whatever the picture's shape; `fit` frames all it draws. */
  readonly framing: 'shown' | 'fit';
  /** Text at this multiple of the view's own: labels and ticks. */
  readonly text: number;
}

/** A picture's width and height in pixels. */
export const pixelsOf = ({ layout, ratio }: PictureSize) => [Math.max(1, Math.round(layout[0] * ratio)), Math.max(1, Math.round(layout[1] * ratio))] as const;

/**
 * Pictures draw no canvas, so they take no input; nothing glows in them, and they move on their own clock, as the user asked
 * of them, whatever their system's motion setting.
 */
const still: Controls = { hover: false, motion: 'full' };

/** A plot's height in lines of the view's text, and the most of a picture it takes. */
const plotted = { lines: 14, share: 0.5 };

/** The rows a picture `height` CSS pixels high stacks for `request`: the view, then its plot, which takes its lines or its share. */
function rowsOf(request: ExportRequest, text: number, height: number) {
  const line = (themeOf(request.view.scene)?.text?.size ?? 0) * text;
  const plot = request.plot ? Math.round(Math.min(plotted.lines * line, plotted.share * height)) : 0;
  return { plot, view: Math.max(1, height - plot) };
}

/** The part of its canvas the view showed, `[width, height]` in CSS pixels: beside or above its plot, which the page lays over it. */
const shownOf = ({ canvas, plot }: ExportRequest) =>
  [Math.max(1, canvas[0] - (plot?.dock.right ?? 0)), Math.max(1, canvas[1] - (plot?.dock.bottom ?? 0))] as const;

/**
 * How high a picture `width` CSS pixels wide stands to show the view at the shape it showed, over its plot's full lines: never
 * so short that the plot takes more than its share.
 */
export function heightFor(request: ExportRequest, width: number, text: number): number {
  const { plot } = rowsOf(request, text, Infinity), [shownWidth, shownHeight] = shownOf(request);
  return Math.max(width * shownHeight / shownWidth + plot, plot / plotted.share);
}

/** The color a scene shows behind its marks: a flat map's ground, else its background. */
function groundOf(scene: Scene) {
  const theme = themeOf(scene), space = spaceOf(scene);
  return (space === 'earth' || space === 'mercator' ? theme?.earth?.ground : undefined) ?? theme?.background;
}

/** `scene` as a picture shows it: changing at once, on `ground`, its text at `text` times its size. */
function pictureScene(scene: Scene, text: number, ground = groundOf(scene)): Scene {
  const theme = themeOf(scene), size = theme?.text?.size;
  return { ...scene, controls: still, ease: 0,
    ...theme && { theme: { ...theme, ...ground !== undefined && { background: ground }, ...size !== undefined && { text: { ...theme.text, size: size * text } } } } };
}

/**
 * Views of what `request` shows that draw into pictures: the same data, GPU, scene, and time, without the selection,
 * hover, or anything the page lays over them, and the plot under the view, both on the view's ground. Shown as it is, the view
 * keeps its camera, zoomed so all it showed stays in view in its row; fitted, it frames `request.tables` at its own tilt and
 * heading. A video's plot spans `span`. The caller destroys them; the data stays the live views'.
 */
async function pictureViews(request: ExportRequest, { size, framing, text }: Drawing, span: readonly [number, number] | undefined,
  signal: AbortSignal | undefined): Promise<{ views: View[]; placed: Placed[] }> {
  const views: View[] = [];
  const open = async (live: View, scene: Scene, camera?: Partial<Camera>) => {
    const view = await View.create(null, scene, { sources: live.sources, gpu: live.gpu, ...camera && { camera }, ...signal && { signal } });
    views.push(view);
    view.at = live.at;
    return view;
  };
  try {
    const { view, plot, tables } = request, camera = view.camera, [width, height] = size.layout;
    const scene = pictureScene(view.scene, text);
    const { plot: strip, view: row } = rowsOf(request, text, height), shown = shownOf(request);
    // Zoom is a power of two, so what the view showed stays in view, centered, whatever its row's shape.
    const fitted = framing === 'fit' && !!tables?.length && 'zoom' in camera;
    const zoomed = 'zoom' in camera ? { ...camera, zoom: camera.zoom + Math.log2(Math.min(width / shown[0], row / shown[1])) } : camera;
    const main = await open(view, scene, fitted ? { pitch: camera.pitch, bearing: camera.bearing } : zoomed);
    // A view drawing only into pictures fits as the picture draws it, so the picture never waits for the fit. latkit keeps
    // fitted marks clear of the edges, their markers and labels whole.
    if (fitted) void main.fit({ tables: [...tables] });
    const placed: Placed[] = [{ view: main, region: [0, 0, 1, row / height] }];
    if (plot) {
      const traces = await open(plot.view, pictureScene(plot.view.scene, text, groundOf(scene)), span ? { x: [span[0], span[1]], y: null } : plot.view.camera);
      placed.push({ view: traces, region: [0, row / height, 1, strip / height] });
    }
    return { views, placed };
  } catch (cause) {
    for (const view of views) view.destroy();
    throw cause;
  }
}

/** Writes a picture of what `request` shows to `output`, encoded as `format`; JPEG has no transparency. */
export async function picture(request: ExportRequest, output: WritableStream<Uint8Array>, { format, transparent = false, quality, signal, ...drawing }: Drawing & {
  format: ImageFormat; transparent?: boolean;
  /** JPEG quality, from 1 to 100; latkit's own without one. */
  quality?: number; signal?: AbortSignal;
}): Promise<void> {
  const { views, placed } = await pictureViews(request, drawing, undefined, signal), wait = signal ? { signal } : {};
  let bytes: Uint8Array;
  // Its views and pixels are freed before the file is written.
  try {
    const image = await new Shot(pixelsOf(drawing.size), { scale: drawing.size.ratio, transparent: transparent && format !== 'jpeg', views: placed }).image(wait);
    try { bytes = await image.encode(format, { ...quality === undefined ? {} : { quality }, ...wait }); }
    finally { image.destroy(); }
  } finally {
    for (const view of views) view.destroy();
  }
  await write(output, bytes);
}

/**
 * Writes the run `request` shows, from `from` to `to` seconds at `speed`, to `output` as H.264 in MP4 as it is drawn. Frames
 * follow the video's clock, never the screen's, so it records as fast as the GPU and encoder go; an `orbit` turns the camera
 * that many degrees a second of video. Time moves as the run moves it, branch states too, the page's views following; the run
 * then follows live again if it did, or shows the time it showed. Aborting `signal` aborts the video and `output`.
 */
export async function video(request: ExportRequest & { readonly run: NonNullable<ExportRequest['run']> }, output: WritableStream<Uint8Array>,
  { fps, from, to, speed, orbit = 0, bitrate, signal, progress, ...drawing }: Drawing & {
    fps: number; from: number; to: number; speed: number; orbit?: number;
    /** Bits per second; latkit's own without one. */
    bitrate?: number; signal?: AbortSignal;
    /** Told how much is recorded, from 0 to 1, after each frame. */
    progress?: (done: number) => void;
  }): Promise<void> {
  if (!(to > from) || !(speed > 0)) throw new RangeError('A video needs an end after its start and a speed above zero.');
  const { run } = request, following = run.live, shown = run.playhead.time, length = (to - from) / speed;
  const { views, placed } = await pictureViews(request, drawing, [from, to], signal), detach = views.map(view => run.playhead.attach(view));
  views[0]!.orbit = orbit;
  try {
    const recording = new Shot(pixelsOf(drawing.size), { scale: drawing.size.ratio, views: placed })
      .video({ fps, output, ...bitrate === undefined ? {} : { bitrate }, ...signal && { signal } });
    await recording.record(time => {
      if (time > length) return false;
      run.seek(Math.min(to, from + time * speed));
      return true;
    }, progress && (({ time }) => progress(Math.min(1, time / length))));
  } finally {
    for (const off of detach) off();
    for (const view of views) view.destroy();
    if (following) run.follow();
    else run.seek(shown);
  }
}
