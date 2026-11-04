import type { Scene, View } from 'latkit';
import { beforeEach, expect, it, vi } from 'vitest';
import { Playhead } from '../simulation/playhead.svelte.js';
import { heightFor, picture, video, type Drawing, type ExportRequest } from './export.js';

type Made = { canvas: null; scene: Scene; options: { sources: unknown; camera: unknown; gpu: unknown }; at: number;
  orbit: number; fit: (fit: unknown) => Promise<null>; destroy: () => void };
const mocks = vi.hoisted(() => ({ made: [] as Made[], shots: [] as { pixels: readonly number[]; options: { scale: number; views: unknown[] } }[] }));
vi.mock('latkit', () => ({
  View: { create: async (canvas: Made['canvas'], scene: Scene, options: Made['options']) => {
    const view = { canvas, scene, options, at: 0, orbit: 0, fit: vi.fn(async () => null), destroy: vi.fn() };
    mocks.made.push(view);
    return view;
  } },
  Shot: class {
    constructor(pixels: readonly number[], options: (typeof mocks.shots)[number]['options']) { mocks.shots.push({ pixels, options }); }
    async image() { return { encode: async () => Uint8Array.of(137, 80), destroy: vi.fn() }; }
    // Draws frame n at n / fps, as latkit does, until the step declines one.
    video({ fps }: { fps: number }) {
      return { async record(step: (time: number) => boolean, progress?: (done: { frames: number; time: number }) => void) {
        for (let frames = 0; step(frames / fps);) { frames++; progress?.({ frames, time: frames / fps }); }
      } };
    }
  },
}));

beforeEach(() => { mocks.made.length = 0; mocks.shots.length = 0; });

const live = (scene: Scene, camera: object, at = 0) => ({ scene, camera, at, sources: ['case', 'run'], gpu: 'gpu' }) as unknown as View;
const network: Scene = { space: 'plane', theme: { base: 'dark', background: '#111111', text: { size: 12 } },
  marks: [{ name: 'buses', vertices: ['case', 'Bus'] }, { name: 'lines', edges: ['case', 'Branch'] }], controls: { hover: true }, ease: 0.3 };
const map: Scene = { ...network, space: 'earth', theme: { base: 'dark', background: '#000000', earth: { ground: '#202020' }, text: { size: 12 } } };
const plot: Scene = { space: { plot: { x: { label: null }, y: { label: null } } }, theme: { base: 'dark', background: '#000000', text: { size: 11 } },
  marks: [{ lines: ['simulation-plot', 'Trace'], trace: 'value' }], controls: { gestures: { primary: 'scrub' } } };
const shownAs = (layout: readonly [number, number], ratio: number, text = 1): Drawing => ({ size: { layout, ratio }, framing: 'shown', text });
/** A plot's fourteen lines of the network's text, at 12. */
const strip = 14 * 12;

/**
 * A run of ten seconds showing `network` and its plot at `time`, moved as a RunSession moves it; `seen` holds the time each
 * exported view showed after each seek.
 */
function running(time: number, following: boolean) {
  const moved = vi.fn(), playhead = new Playhead({ moved, end: () => 10, running: () => false }), seen: number[][] = [];
  const shown = { network: live(network, { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 }), plot: live(plot, { x: [0, 10], y: null }) };
  playhead.attach(shown.network); playhead.attach(shown.plot);
  playhead.show(time);
  const run = { playhead, range: [0, 10] as [number, number], live: following,
    seek: vi.fn((at: number) => { run.live = false; playhead.show(at); seen.push(mocks.made.map(view => view.at)); }),
    follow: vi.fn(() => { run.live = true; playhead.show(10); }) };
  return { run, moved, playhead, shown, seen };
}

it('pictures what is shown from a view of its own, still, on the ground it shows, its text scaled, sharing the shown data, GPU, camera, and time', async () => {
  const request: ExportRequest = { view: live(map, { center: [1, 2], zoom: 3 }, 4), canvas: [800, 600] };
  const written: Uint8Array[] = [], freed: number[] = [];
  await picture(request, new WritableStream({ write: chunk => { written.push(chunk); freed.push(...mocks.made.map(view => vi.mocked(view.destroy).mock.calls.length)); } }),
    { ...shownAs([800, 600], 2, 1.5), format: 'png' });
  const [view] = mocks.made;
  expect(written).toEqual([Uint8Array.of(137, 80)]);
  // Its views are freed before the file is written.
  expect(freed).toEqual([1]);
  expect(mocks.shots[0]).toMatchObject({ pixels: [1600, 1200], options: { scale: 2, views: [{ view, region: [0, 0, 1, 1] }] } });
  // A flat map's ground is the picture's: nothing shows another color around the earth.
  expect(view!.scene).toMatchObject({ controls: { hover: false, motion: 'full' }, ease: 0, theme: { background: '#202020', text: { size: 18 } } });
  // latkit draws the marks and options a view leaves out the same in its pictures.
  expect(view!.scene.marks).toEqual(map.marks);
  expect(view!.options).toEqual({ sources: ['case', 'run'], camera: { center: [1, 2], zoom: 3 }, gpu: 'gpu' });
  expect(view!.at).toBe(4);
});

it('fits all a view draws to a picture of another shape, at its own tilt, as the picture draws it', async () => {
  const request: ExportRequest = { view: live(network, { center: [1, 2], zoom: 3, pitch: 30, bearing: 10 }), canvas: [800, 600],
    tables: [['case', 'Bus'], ['case', 'Branch']] };
  await picture(request, new WritableStream(), { size: { layout: [360, 640], ratio: 3 }, framing: 'fit', text: 1, format: 'png' });
  const [view] = mocks.made;
  expect(mocks.shots[0]).toMatchObject({ pixels: [1080, 1920], options: { scale: 3, views: [{ view, region: [0, 0, 1, 1] }] } });
  expect(view!.canvas).toBeNull();
  expect(view!.options.camera).toEqual({ pitch: 30, bearing: 10 });
  expect(view!.fit).toHaveBeenCalledWith({ tables: [['case', 'Bus'], ['case', 'Branch']] });
});

it('stands a page as high as the view showed, over its plot', () => {
  const request: ExportRequest = { view: live(network, {}), canvas: [800, 600], plot: { view: live(plot, {}), dock: { right: 0, bottom: 150 } } };
  // A column's view is the shape the view showed, 800 by 450 above its plot.
  expect(heightFor(request, 336, 1)).toBeCloseTo(189 + strip);
  // A narrower page's view stands as high as its plot, so the plot never takes more than half the page.
  expect(heightFor(request, 200, 1)).toBe(2 * strip);
  // Beside the plot, the view showed 600 by 600.
  expect(heightFor({ ...request, plot: { ...request.plot!, dock: { right: 200, bottom: 0 } } }, 336, 1)).toBeCloseTo(336 + strip);
});

it("records the run on the video's clock with its plot beneath, on one ground, orbiting, then shows the time it showed before", async () => {
  const { run, moved, playhead, shown, seen } = running(0.5, false);
  const progress = vi.fn(), request = { view: shown.network, canvas: [800, 600] as const, run, plot: { view: shown.plot, dock: { right: 0, bottom: 150 } } };
  await video(request, new WritableStream(), { ...shownAs([960, 540], 2), fps: 4, from: 1, to: 2, speed: 0.5, orbit: 6, progress });

  // Two seconds of video at four frames a second spans one second of the run.
  const times = Array.from({ length: 9 }, (_, frame) => 1 + frame / 8);
  expect(run.seek.mock.calls.map(([time]) => time)).toEqual([...times, 0.5]);
  expect(seen.slice(0, -1)).toEqual(times.map(time => [time, time]));
  expect(progress).toHaveBeenLastCalledWith(1);
  // The plot takes its lines of text; the view, what the plot leaves.
  const [main, traces] = mocks.made, row = 540 - strip;
  expect(mocks.shots[0]).toMatchObject({ pixels: [1920, 1080], options: { scale: 2,
    views: [{ view: main, region: [0, 0, 1, row / 540] }, { view: traces, region: [0, row / 540, 1, strip / 540] }] } });
  // A picture of another shape zooms so all the view showed, above its plot, stays in view.
  expect(main!.options.camera).toEqual({ center: [0, 0], zoom: 2 + Math.log2(row / 450), pitch: 0, bearing: 0 });
  expect(main!.orbit).toBe(6);
  expect(traces!.options.camera).toEqual({ x: [1, 2], y: null });
  expect(traces!.scene).toMatchObject({ ease: 0, theme: { background: '#111111' }, space: plot.space });
  expect([...playhead.views]).toEqual([shown.network, shown.plot]);
  for (const view of mocks.made) expect(view.destroy).toHaveBeenCalledOnce();
  expect([playhead.time, shown.network.at, shown.plot.at, run.live]).toEqual([0.5, 0.5, 0.5, false]);
  expect(moved).toHaveBeenLastCalledWith(0.5);
});

it('leaves a run that followed live following it again', async () => {
  const { run, playhead, shown } = running(10, true);
  await video({ view: shown.network, canvas: [800, 600], run }, new WritableStream(), { ...shownAs([800, 600], 1), fps: 2, from: 0, to: 1, speed: 1 });
  expect(run.seek.mock.calls.map(([time]) => time)).toEqual([0, 0.5, 1]);
  expect(run.follow).toHaveBeenCalledOnce();
  expect([run.live, playhead.time]).toEqual([true, 10]);
});
