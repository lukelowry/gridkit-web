<script lang="ts">
  import { onMount } from 'svelte';
  import { View, type Scene, type Hit } from 'latkit';
  import type { PlotAxis, PlotData, PlotViewport } from './plot.js';
  import type { Playhead } from './playhead.svelte.js';
  import { measureUnit } from '../domain/measure.js';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import { latkit } from '../ui/latkit.js';
  import { gesturesOf } from '../ui/latkit.js';
  import { colorHex } from '../ui/color.js';
  import { errorMessage } from '../ui/errors.js';

  let { plot, playhead, preferences, onseek, onviewport, onaxis, onretry }: {
    plot: PlotData; playhead: Playhead; preferences: PreferencesState;
    onretry: () => void;
    onseek: (time: number) => void; onviewport: (viewport: PlotViewport, pixels: number, manual?: boolean) => void;
    /** Where the time axis is drawn, whenever it moves: a resize, a zoom, or wider value labels. */
    onaxis: (axis: PlotAxis) => void;
  } = $props();
  let canvas: HTMLCanvasElement;
  let view = $state.raw<View>();
  let error = $state('');
  let ready = $state(false);
  let typography = $state.raw<{ font: string; size: number }>();
  let hovered = $state.raw<Hit | null>(null);
  let appliedView: View | undefined;
  let appliedVersion = -1;
  export function focus() { canvas.focus({ preventScroll: true }); }
  const quantity = $derived(plot.quantity);
  const unit = $derived(measureUnit(quantity.unit, plot.basis));
  const hoveredChannel = $derived(quantity.channels.find(channel => channel.column === hovered?.row.id));
  const palette = $derived.by(() => {
    void preferences.theme; void preferences.contrast;
    const css = getComputedStyle(document.documentElement);
    const read = (name: string) => colorHex(css.getPropertyValue(name).trim(), true) ?? '#808080';
    return { bg: read('--color-surface-1'), grid: read('--color-graph-grid'), text: read('--color-text-1'), ticks: read('--color-text-3'),
      lines: [read('--color-primary-text'), '#0072b2', '#009e73', '#d55e00', '#cc79a7', '#56b4e9', '#e69f00', '#6c6c6c'] };
  });
  const scene = $derived<Scene>({
    ease: 0,
    // The dock names the quantity, units, and time; the canvas keeps only the numeric axes.
    space: { plot: { x: { label: null }, y: { label: null } } },
    // Traces keep 4.5:1 contrast with the plot's ground, or 7:1 in high contrast.
    theme: { base: preferences.theme, background: palette.bg, grid: palette.grid, contrast: preferences.contrast === 'high' ? 7 : 4.5,
      text: { color: palette.ticks, ...typography }, plot: { playhead: palette.text } },
    marks: [{ lines: ['simulation-plot', 'Trace'], trace: 'value', interpolation: 'linear',
      color: { colormap: { kind: 'categorical', colors: palette.lines }, value: '$series' }, width: preferences.contrast === 'high' ? 2.5 : 1.5 }],
    // Pressing or dragging across the plot moves the time shown.
    controls: { gestures: { ...gesturesOf(preferences.value.wheel), primary: 'scrub' },
      motion: preferences.motion === 'reduce' ? 'reduced' : 'full' },
  });

  onMount(() => {
    let disposed = false;
    let live: View | undefined;
    let resizeFrame = 0;
    const listeners: (() => void)[] = [];
    let measured = '';
    // Resolve the shared caption role once and on resize, never on playback frames.
    const readTypography = () => {
      const css = getComputedStyle(canvas), font = css.fontFamily, size = parseFloat(css.fontSize);
      if (typography?.font !== font || typography?.size !== size) typography = { font, size };
    };
    readTypography();
    // The axis's ends on screen: projecting the times shown finds them wherever the value labels leave the plot area.
    const measure = () => {
      const camera = live?.camera;
      if (disposed || !live || !camera || !('x' in camera)) return;
      const value = camera.y?.[0] ?? 0, start = live.screen([camera.x[0], value, 0]), end = live.screen([camera.x[1], value, 0]);
      if (!start || !end) return;
      const axis = { left: Math.round(start[0]), width: Math.round(end[0] - start[0]), from: camera.x[0], to: camera.x[1] }, key = JSON.stringify(axis);
      if (key !== measured) { measured = key; onaxis(axis); }
    };
    const report = (manual = false) => {
      measure();
      if (disposed || !live) return;
      const camera = live.camera;
      if ('x' in camera) onviewport({ x: [...camera.x], y: camera.y ? [...camera.y] : null }, canvas.width, manual);
    };
    const observer = new ResizeObserver(() => {
      readTypography();
      // Both canvas observers run before drawing. Measure after the renderer has drawn its new size.
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { resizeFrame = requestAnimationFrame(() => report()); });
    }); observer.observe(canvas);
    void (async () => {
      try {
        await latkit();
        if (disposed) return;
        const camera = plot.camera;
        live = await View.create(canvas, scene, { sources: [plot.data], camera: { x: [...camera.x], y: camera.y ? [...camera.y] : null } });
        if (disposed) { live.destroy(); return; }
        appliedView = live; appliedVersion = camera.version;
        // Streaming can keep summaries refining while valid frames are on screen: the plot is ready once one is drawn.
        listeners.push(live.on('at', at => onseek(at)), live.on('hovered', ({ hit }) => { hovered = hit; }),
          live.on('camera', () => report(true)), live.on('waiting', () => { ready ||= live!.stats.frames > 0; measure(); }),
          live.on('error', failure => { error = failure.message; }));
        view = live; report();
      } catch (cause) { if (!disposed) error = errorMessage(cause); }
    })();
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(resizeFrame); listeners.forEach(off => off()); live?.destroy(); };
  });
  $effect(() => { if (view) view.scene = scene; });
  $effect(() => { if (view) return playhead.attach(view); });
  $effect(() => {
    const current = view, camera = plot.camera;
    if (!current || (current === appliedView && camera.version === appliedVersion)) return;
    current.camera = { x: [...camera.x], y: camera.y ? [...camera.y] : null };
    appliedView = current; appliedVersion = camera.version;
  });
</script>

<div class="plot-canvas">
  <canvas bind:this={canvas} tabindex={error ? -1 : 0} aria-busy={!ready && !error}
    aria-label={`${quantity.label} plot${unit ? ` (${unit})` : ''}, time in seconds`}></canvas>
  {#if hoveredChannel && hovered?.sample}
    <output class="trace-detail" aria-live="off"><bdi>{hoveredChannel.label}</bdi>: {plot.basis === 'value' ? '' : 'Δ'}{hovered.sample.value.toPrecision(6)} {unit} at {hovered.sample.at.toFixed(3)} s</output>
  {/if}
  {#if error}
    <div class="plot-error">
      <p role="alert">The plot could not be drawn. Try loading it again.</p>
      <button type="button" onclick={onretry}>Retry plot</button>
      <details><summary>Details</summary><p dir="auto">{error}</p></details>
    </div>
  {/if}
</div>

<style>
  .plot-canvas { position: relative; height: 100%; min-height: 0; }
  canvas { display: block; width: 100%; height: 100%; font: var(--type-caption); }
  .trace-detail { position: absolute; top: 4px; right: 8px; max-width: calc(100% - 64px); overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; padding: 2px 4px; background: var(--color-surface-1); font: var(--type-caption); pointer-events: none; }
  .plot-error { position: absolute; inset: 8px; overflow: auto; overscroll-behavior: contain; padding: 8px;
    background: var(--color-surface-1); font: var(--type-compact); overflow-wrap: anywhere; }
  .plot-error p { margin: 0; }
  .plot-error > p { color: var(--color-error); }
  .plot-error button { margin-block: 8px; border-color: var(--color-border); }
  .plot-error details { color: var(--color-text-2); font: var(--type-caption); }
</style>
