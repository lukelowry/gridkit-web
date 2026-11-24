import { Data, Gpu, View, field, reference, type Scene } from 'latkit';
import { defaults } from '../src/preferences/definitions.js';
import { controlsOf } from '../src/ui/latkit.js';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;
/** Animation frames each phase changes the view in. */
const phaseFrames = 24;

/**
 * Calls `change` in each of `count` animation frames, before the views draw, and resolves to the CPU time each frame took to record
 * and the time between frames.
 */
function frames(gpu: Gpu, view: View, count: number, change: (frame: number) => void) {
  const cpu: number[] = [], gaps: number[] = [];
  let previous = 0, frame = 0;
  return new Promise<{ cpu: number[]; gaps: number[] }>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`Performance frames timed out after ${frame} frames: ${JSON.stringify({ stats: view.stats, lost: gpu.lost, failures: view.failures })}`)); }, 30_000);
    const off = gpu.on('frame', now => {
      try {
        if (previous) gaps.push(now - previous);
        previous = now;
        cpu.push(view.stats.cpuMs);
        if (++frame > count) { off(); clearTimeout(timer); resolve({ cpu, gaps }); return; }
        change(frame);
      } catch (error) { off(); clearTimeout(timer); reject(error); }
    });
  });
}

/**
 * A phase's frames, once the last of them has drawn: the frames the view drew each second of it, which the controls' frame rate
 * caps while only time or comets move, and the GPU time, the median latkit keeps of the last frames measured.
 */
async function phase(gpu: Gpu, view: View, change: (frame: number) => void) {
  const drawn = view.stats.frames, started = performance.now();
  const { cpu, gaps } = await frames(gpu, view, phaseFrames, change);
  const fps = (view.stats.frames - drawn) * 1000 / (performance.now() - started);
  await view.done({ signal: AbortSignal.timeout(30_000) });
  return { fps, cpuP50: percentile(cpu, 0.5), cpuP95: percentile(cpu, 0.95), frameGapP95: percentile(gaps, 0.95), gpuMs: view.stats.gpuMs };
}

/** Browser-only probe, loaded by performance.probe.ts through the development server. Never included in the app build. */
export async function measureNetwork(size: number, budgetMiB: number, detail: 'plain' | 'markers' | 'halos' | 'labels' = 'plain') {
  const gpu = await Gpu.create();
  gpu.budget = { ...gpu.budget, bytes: Math.min(gpu.budget.bytes, budgetMiB * 1024 * 1024) };
  const data = new Data('benchmark'), samples = new Data('benchmark-results').axis('Time', 's');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:10000;background:white';
  document.body.append(canvas);
  let view: View | undefined;
  try {
    const side = Math.ceil(Math.sqrt(size));
    data.replace('Bus', { count: size }, {
      ...(detail === 'labels' && { caption: Array.from({ length: size }, (_, i) => String(i)) }),
      x: Float64Array.from({ length: size }, (_, i) => i % side),
      y: Float64Array.from({ length: size }, (_, i) => Math.floor(i / side)),
    });
    data.replace('Branch', { count: size }, {
      from: reference('Bus', Uint32Array.from({ length: size }, (_, i) => i % 20 === 1 ? i - 1 : i)),
      to: reference('Bus', Uint32Array.from({ length: size }, (_, i) => Math.min(size - 1, i % 20 === 1 ? i : i + 1))),
    });
    // A recording of every bus, as a run's results are: four frames a second apart, each bus a step further around its range.
    const recorded = [0, 1, 2, 3];
    samples.replace('Bus', { count: size }, {});
    samples.append('Bus', recorded, { Vm: Float32Array.from({ length: size * recorded.length }, (_, k) => ((k % size) % 97 / 97 + Math.floor(k / size) / 3) % 1) });
    const voltage = field('Vm').from(['benchmark-results', 'Bus']), started = performance.now();
    // Branches under buses, as the network draws them, with the editor's controls: comets draw at its default frame rate.
    const sceneWith = (flow: number): Scene => ({
      space: 'plane', layout: 'none', ease: 0, theme: { base: 'light', ...detail === 'halos' && { edge: { halo: 1 } } }, controls: controlsOf(defaults, 'full'),
      marks: [
        { edges: ['benchmark', 'Branch'], ends: ['from', 'to'], width: 0.7, ...detail === 'markers' && { markers: [{ marker: 'rectangle', at: 0.5, size: 4 }] }, ...flow ? { flow } : {} },
        { vertices: ['benchmark', 'Bus'], position: ['$x', '$y'], ...detail === 'labels' && { label: { text: '$caption', place: 'right' } }, elevation: voltage.scale(0, 15).domain(0, 1),
          radius: { units: 0.15, atLeast: 0.5, atMost: 4 }, color: voltage.colormap('viridis').domain(0, 1) },
      ],
    });
    view = await View.create(canvas, sceneWith(0), { gpu, sources: [data, samples], camera: { pitch: 45 } });
    try { await view.done({ signal: AbortSignal.timeout(30_000) }); }
    catch (error) { throw new Error('Initial draw failed (' + (error instanceof Error ? error.message : String(error)) + '): ' + JSON.stringify({ waiting: view.waiting, resident: gpu.resident,
      frames: view.stats.frames, failures: view.failures.map(f => f.message) }), { cause: error }); }
    const openMs = performance.now() - started, before = gpu.work, camera = view.camera;
    const play = (frame: number) => { view!.at = (frame % 60) / 20; };
    // The camera and the time shown move every frame, so every mark draws, each frame.
    const moving = await phase(gpu, view, frame => {
      play(frame);
      if ('center' in camera) view!.camera = { center: [camera.center[0] + Math.sin(frame / 20) * side / 20, camera.center[1]], bearing: frame / 5 };
    });
    // As results play, only the time shown moves: the buses draw over the image kept of the branches, at the controls' frame rate.
    const playing = await phase(gpu, view, play);
    // A hover moving from bus to bus draws only the rows it lights over the image kept of every mark.
    const hovering = await phase(gpu, view, frame => { view!.hovered = { data: 'benchmark', table: 'Bus', id: (frame * 7919) % size }; });
    view.hovered = null;
    await view.done();
    const picks: number[] = [];
    for (let i = 0; i < 5; i++) {
      const at = performance.now();
      await view.pick([canvas.clientWidth / 2 + i, canvas.clientHeight / 2], { radius: 4 });
      picks.push(performance.now() - at);
    }
    await pause(250);
    const idleFrames = view.stats.frames;
    await pause(150);
    if (view.stats.frames !== idleFrames) throw new Error('An idle view kept drawing.');
    const stats = view.stats, work = gpu.work;
    if (view.failures.length) throw new Error(JSON.stringify(view.failures));
    // Comets along every branch while nothing else moves: the view draws at the controls' frame rate, and each frame only the comets.
    view.scene = sceneWith(40);
    await view.done({ signal: AbortSignal.timeout(30_000) });
    const cometsFrom = view.stats.frames, cometsStarted = performance.now();
    const cometFrames = await frames(gpu, view, 60, () => {});
    const comets = { fps: (view.stats.frames - cometsFrom) * 1000 / (performance.now() - cometsStarted),
      cpuP50: percentile(cometFrames.cpu, 0.5), gpuMs: view.stats.gpuMs };
    if (view.failures.length) throw new Error(JSON.stringify(view.failures));
    const recovery = performance.now();
    gpu.lose();
    // A previously complete frame predates the reset; wait for the replacement device first.
    while (gpu.lost) {
      if (performance.now() - recovery > 30_000) throw new Error('GPU recovery timed out.');
      await pause(10);
    }
    await view.done({ signal: AbortSignal.timeout(30_000) });
    return { size, budgetMiB, detail, openMs, moving, playing, hovering, comets, pickP50: percentile(picks, 0.5),
      instances: stats.instances, resident: gpu.resident, uploaded: work.uploaded - before.uploaded,
      evaluated: work.evaluated - before.evaluated, late: work.late - before.late,
      recoveryMs: performance.now() - recovery, idle: true };
  } finally { view?.destroy(); samples.destroy(); data.destroy(); gpu.destroy(); canvas.remove(); }
}
