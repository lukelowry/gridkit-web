import type { Scene, View } from 'latkit';
import { beforeEach, expect, it, vi } from 'vitest';
import { Playhead } from '../simulation/playhead.svelte.js';
import { composition, heightFor, picture, video, videoSize, pixelsOf, type Drawing, type ExportRequest } from './export.js';

const mocks = vi.hoisted(() => ({
  made: [] as View[],
  shots: [] as { pixels: readonly number[]; scale: number; views: { view: View; region: readonly number[] }[]; scenes: Scene[]; cameras: unknown[] }[],
  encode: vi.fn(async () => Uint8Array.of(137, 80)),
}));
vi.mock('latkit', () => ({
  View: { create: async (_canvas: null, scene: Scene, options: { sources: unknown; camera: unknown; gpu: unknown }) => {
    const view = { scene, ...options, at: 0, orbit: 0, fit: vi.fn(async () => null), destroy: vi.fn() } as unknown as View;
    mocks.made.push(view);
    return view;
  } },
  Shot: class {
    constructor(pixels: readonly number[], options: { scale: number; views: { view: View; region: readonly number[] }[] }) {
      mocks.shots.push({ pixels, ...options, scenes: options.views.map(({ view }) => view.scene), cameras: options.views.map(({ view }) => view.camera) });
    }
    async image() { return { encode: mocks.encode, destroy: vi.fn() }; }
    video({ fps }: { fps: number }) {
      return { async record(step: (time: number) => boolean, progress?: (done: { frames: number; time: number }) => void) {
        for (let frames = 0; step(frames / fps);) { frames++; progress?.({ frames, time: frames / fps }); }
      } };
    }
  },
}));
beforeEach(() => { mocks.made.length = 0; mocks.shots.length = 0; mocks.encode.mockReset().mockResolvedValue(Uint8Array.of(137, 80)); });
const gpu = { on: vi.fn(() => vi.fn()) };
const live = (scene: Scene, camera: object, at = 0) => ({
  scene, camera, at, orbit: 2, insets: { right: -200 }, selection: [], sources: ['case', 'run'], gpu,
}) as unknown as View;
const network: Scene = { space: 'earth', theme: { base: 'dark', background: '#000000', earth: { ground: '#202020' }, text: { size: 12 } },
  marks: [{ name: 'buses', vertices: ['case', 'Bus'] }], controls: { hover: true }, ease: 0.3 };
const plot: Scene = { space: { plot: { x: { label: null }, y: { label: null } } }, theme: { base: 'light', background: '#ffffff', text: { size: 11 } },
  marks: [{ lines: ['simulation-plot', 'Trace'], trace: 'value' }] };
const shownAs = (layout: readonly [number, number], ratio = 1, text = 1): Drawing => ({ size: { layout, ratio }, framing: 'shown', text });
function running(time: number, following = false) {
  const playhead = new Playhead({ moved: vi.fn(), end: () => 10, running: () => false });
  const shown = { network: live(network, { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 }), plot: live(plot, { x: [0, 10], y: [0, 2] }) };
  playhead.attach(shown.network); playhead.attach(shown.plot); playhead.show(time);
  const run = { playhead, range: [0, 10] as const, live: following,
    seek: vi.fn((at: number) => { run.live = false; playhead.pause(); playhead.show(at); }),
    follow: vi.fn(() => { run.live = true; playhead.show(10); }) };
  return { run, playhead, shown };
}
it('captures the actual layout and camera, preserves colors, then restores the borrowed view before writing', async () => {
  const view = live(network, { center: [1, 2], zoom: 3, bearing: 4, pitch: 30 }, 4), before = { ...view };
  const written: Uint8Array[] = [];
  await picture({ view, canvas: [800, 600] }, new WritableStream({ write: chunk => {
    written.push(chunk); expect(view).toEqual(before);
  } }), { ...shownAs([800, 600], 2, 1.5), format: 'png' });
  expect(written).toEqual([Uint8Array.of(137, 80)]);
  expect(mocks.made).toHaveLength(0);
  expect(mocks.shots[0]).toMatchObject({ pixels: [1600, 1200], scale: 2, views: [{ view, region: [0, 0, 1, 1] }],
    scenes: [{ controls: { hover: false, motion: 'full' }, ease: 0, theme: { background: '#000000', text: { size: 18 } } }],
    cameras: [{ center: [1, 2], zoom: 3, bearing: 4, pitch: 30 }] });
});
it('fits a separate view without changing the live camera or layout', async () => {
  const view = live(network, { center: [1, 2], zoom: 3, pitch: 30, bearing: 10 }), before = { ...view };
  await picture({ view, canvas: [800, 600], tables: [['case', 'Bus']] }, new WritableStream(),
    { ...shownAs([360, 640], 3), framing: 'fit', format: 'png' });
  expect(mocks.made[0]!.fit).toHaveBeenCalledWith({ tables: [['case', 'Bus']] });
  expect(mocks.shots[0]).toMatchObject({ pixels: [1080, 1920], scale: 3, cameras: [{ pitch: 30, bearing: 10 }] });
  expect(mocks.made[0]!.destroy).toHaveBeenCalledOnce();
  expect(view).toEqual(before);
});
it('preserves aspect, dock side and share at any pixel density', () => {
  const request: ExportRequest = { view: live(network, {}), canvas: [800, 600], plot: { view: live(plot, {}), dock: { right: 200, bottom: 0 } } };
  expect(composition(request, shownAs([800, 600], 2))).toEqual({ scale: 2, main: [0, 0, 1, 1], plot: [.75, 0, .25, 1] });
  const wide = composition(request, shownAs([1200, 600], 2));
  expect(wide.scale).toBe(2);
  expect(wide.main[0]).toBeCloseTo(1 / 6); expect(wide.main[2]).toBeCloseTo(2 / 3);
  expect(composition({ ...request, plot: { ...request.plot!, dock: { right: 0, bottom: 150 } } }, shownAs([800, 600])))
    .toEqual({ scale: 1, main: [0, 0, 1, 1], plot: [0, .75, 1, .25] });
  expect(heightFor(request, 336)).toBe(252);
});
it('uses encoder dimensions for both preview and video', () => {
  expect(pixelsOf(videoSize({ layout: [401, 301], ratio: 1 }))).toEqual([400, 300]);
});
it('previews and records the same plot bounds, colors and arrangement, restoring playback afterward', async () => {
  const { run, playhead, shown } = running(.5);
  playhead.play();
  const request: ExportRequest & { run: typeof run } = { view: shown.network, canvas: [800, 600], run, plot: { view: shown.plot, dock: { right: 200, bottom: 0 } } };
  const options = shownAs([800, 600]);
  await picture(request, new WritableStream(), { ...options, format: 'png', frame: { at: 1, turn: 0, span: [1, 2] } });
  const preview = mocks.shots[0]!;
  const progress = vi.fn();
  await video(request, new WritableStream(), { ...options, fps: 4, from: 1, to: 2, speed: .5, orbit: 6, progress });
  const recording = mocks.shots[1]!;
  expect(recording.cameras).toEqual(preview.cameras);
  expect(recording.scenes).toEqual(preview.scenes);
  expect(recording.views.map(v => v.region)).toEqual(preview.views.map(v => v.region));
  expect(recording.scenes[1]).toMatchObject({ theme: { background: '#ffffff' } });
  expect(progress).toHaveBeenLastCalledWith(1);
  expect([...playhead.views]).toEqual([shown.network, shown.plot]);
  expect([playhead.time, playhead.playing, shown.network.at, run.live]).toEqual([.5, true, .5, false]);
  expect(shown.network.camera).toMatchObject({ bearing: 0 });
  for (const view of mocks.made) expect(view.destroy).toHaveBeenCalledOnce();
});
it('restores a following run after recording', async () => {
  const { run, playhead, shown } = running(10, true);
  await video({ view: shown.network, canvas: [800, 600], run }, new WritableStream(), { ...shownAs([800, 600]), fps: 2, from: 0, to: 1, speed: 1 });
  expect(run.seek.mock.calls.map(([time]) => time)).toEqual([0, 0, .5, 1]);
  expect(run.follow).toHaveBeenCalledOnce();
  expect([run.live, playhead.time]).toEqual([true, 10]);
});
it('serializes overlapping previews and restores the view after a failed capture', async () => {
  const view = live(network, { zoom: 3, bearing: 0 }), before = { ...view };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mocks.encode.mockImplementationOnce(async () => { await gate; throw new Error('Lost GPU'); });
  const request: ExportRequest = { view, canvas: [800, 600] };
  const first = picture(request, new WritableStream(), { ...shownAs([800, 600]), format: 'png' });
  const failed = expect(first).rejects.toThrow('Lost GPU');
  const second = picture(request, new WritableStream(), { ...shownAs([800, 600]), format: 'png' });
  await vi.waitFor(() => expect(mocks.shots).toHaveLength(1));
  release(); await failed; await second;
  expect(mocks.shots).toHaveLength(2); expect(view).toEqual(before);
});
