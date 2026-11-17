import { Data, Gpu, View, field, reference } from 'latkit';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;

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
    view = await View.create(canvas, {
      space: 'plane', layout: 'none', ease: 0, theme: { base: 'light' },
      marks: [
        { edges: ['benchmark', 'Branch'], ends: ['from', 'to'], width: 0.7 },
        { vertices: ['benchmark', 'Bus'], position: ['$x', '$y'], elevation: voltage.scale(0, 15).domain(0, 1),
          radius: { units: 0.15, atLeast: 0.5, atMost: 4 }, color: voltage.colormap('viridis').domain(0, 1) },
      ],
    }, { gpu, sources: [data, samples], camera: { pitch: 45 } });
    await view.done({ signal: AbortSignal.timeout(30_000) });
    const openMs = performance.now() - started, before = gpu.work, cpu: number[] = [], frameGaps: number[] = [];
    const camera = view.camera;
    let previous = 0, frame = 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`Performance frames timed out after ${frame} frames: ${JSON.stringify({ stats: view!.stats, lost: gpu.lost, failures: view!.failures })}`)); }, 30_000);
      const off = gpu.on('frame', now => {
        try {
          if (previous) frameGaps.push(now - previous);
          previous = now;
          cpu.push(view!.stats.cpuMs);
          if (++frame > 24) { off(); clearTimeout(timer); resolve(); return; }
          values.fill((frame % 60) / 60);
          samples.set('Bus', { count: size }, { Vm: values });
          if ('center' in camera) view!.camera = { center: [camera.center[0] + Math.sin(frame / 20) * side / 20, camera.center[1]], bearing: frame / 5 };
        } catch (error) { off(); clearTimeout(timer); reject(error); }
      });
    });
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
    const recovery = performance.now();
    gpu.lose();
    // A previously complete frame predates the reset; wait for the replacement device first.
    while (gpu.lost) {
      if (performance.now() - recovery > 30_000) throw new Error('GPU recovery timed out.');
      await pause(10);
    }
    await view.done({ signal: AbortSignal.timeout(30_000) });
    return { size, budgetMiB, measuredFrames: frame, openMs, cpuP50: percentile(cpu, 0.5), cpuP95: percentile(cpu, 0.95),
      frameGapP95: percentile(frameGaps, 0.95), gpuMs: stats.gpuMs, pickP50: percentile(picks, 0.5),
      instances: stats.instances, resident: gpu.resident, uploaded: work.uploaded - before.uploaded,
      evaluated: work.evaluated - before.evaluated, late: work.late - before.late,
      recoveryMs: performance.now() - recovery, idle: true };
  } finally { view?.destroy(); samples.destroy(); data.destroy(); gpu.destroy(); canvas.remove(); }
}
