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

/** A phase's frames, once the last of them has drawn: the GPU time is the median latkit keeps of the last frames measured. */
async function phase(gpu: Gpu, view: View, change: (frame: number) => void) {
  const { cpu, gaps } = await frames(gpu, view, phaseFrames, change);
  await view.done({ signal: AbortSignal.timeout(30_000) });
  return { cpuP50: percentile(cpu, 0.5), cpuP95: percentile(cpu, 0.95), frameGapP95: percentile(gaps, 0.95), gpuMs: view.stats.gpuMs };
}

/** Browser-only probe, loaded by performance.probe.ts through the development server. Never included in the app build. */
export async function measureNetwork(size: number, budgetMiB: number) {
  const gpu = await Gpu.create();
  gpu.budget = { ...gpu.budget, bytes: Math.min(gpu.budget.bytes, budgetMiB * 1024 * 1024) };
  const data = new Data('benchmark'), samples = new Data('benchmark-results');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:10000;background:white';
  document.body.append(canvas);
  let view: View | undefined;
  try {
    const side = Math.ceil(Math.sqrt(size)), values = new Float32Array(size).fill(0.5);
    data.replace('Bus', { count: size }, {
      x: Float64Array.from({ length: size }, (_, i) => i % side),
      y: Float64Array.from({ length: size }, (_, i) => Math.floor(i / side)),
    });
    data.replace('Branch', { count: size }, {
      from: reference('Bus', Uint32Array.from({ length: size }, (_, i) => i % 20 === 1 ? i - 1 : i)),
      to: reference('Bus', Uint32Array.from({ length: size }, (_, i) => Math.min(size - 1, i % 20 === 1 ? i : i + 1))),
    });
    samples.replace('Bus', { count: size }, { Vm: values });
    const voltage = field('Vm').from(['benchmark-results', 'Bus']), started = performance.now();
    // Branches under buses, as the network draws them, with the editor's controls: comets draw at its default frame rate.
    const sceneWith = (flow: number): Scene => ({
      space: 'plane', layout: 'none', ease: 0, theme: { base: 'light' }, controls: controlsOf(defaults, 'full'),
      marks: [
        { edges: ['benchmark', 'Branch'], ends: ['from', 'to'], width: 0.7, ...flow ? { flow } : {} },
        { vertices: ['benchmark', 'Bus'], position: ['$x', '$y'], elevation: voltage.scale(0, 15).domain(0, 1),
          radius: { units: 0.15, atLeast: 0.5, atMost: 4 }, color: voltage.colormap('viridis').domain(0, 1) },
      ],
    });
    view = await View.create(canvas, sceneWith(0), { gpu, sources: [data, samples], camera: { pitch: 45 } });
    await view.done({ signal: AbortSignal.timeout(30_000) });
    const openMs = performance.now() - started, before = gpu.work, camera = view.camera;
    const vary = (frame: number) => { values.fill((frame % 60) / 60); samples.set('Bus', { count: size }, { Vm: values }); };
    // The camera and the buses change every frame, so every mark draws.
    const moving = await phase(gpu, view, frame => {
      vary(frame);
      if ('center' in camera) view!.camera = { center: [camera.center[0] + Math.sin(frame / 20) * side / 20, camera.center[1]], bearing: frame / 5 };
    });
    // As results play, the buses change and the camera rests: each frame draws them over the image kept of the branches.
    const playing = await phase(gpu, view, vary);
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
    return { size, budgetMiB, openMs, moving, playing, hovering, comets, pickP50: percentile(picks, 0.5),
      instances: stats.instances, resident: gpu.resident, uploaded: work.uploaded - before.uploaded,
      evaluated: work.evaluated - before.evaluated, late: work.late - before.late,
      recoveryMs: performance.now() - recovery, idle: true };
  } finally { view?.destroy(); samples.destroy(); data.destroy(); gpu.destroy(); canvas.remove(); }
}
