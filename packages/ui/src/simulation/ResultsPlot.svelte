<script lang="ts">
  import { watchNotice } from '../ui/toasts.svelte.js';
  import { onMount } from 'svelte';
  import type { ElementRef } from '@gridkit/library';
  import type { Channel } from '@gridkit/library/gridkit';
  import { sameReference } from '../domain/entries.js';
  import { PlotElements } from './inspection.js';
  import { View, type Scene, type Hit } from 'latkit';
  import type { PlotAxis, PlotData, PlotViewport } from './plot.js';
  import type { Playhead } from './playhead.svelte.js';
  import { measureUnit } from '../domain/measure.js';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import { gesturesOf, latkit } from '../ui/latkit.js';
  import { colorHex } from '../ui/color.js';
  import { errorMessage } from '../ui/errors.js';

  let { plot, playhead, preferences, onseek, onviewport, onaxis, onretry, selected, hovered, onselect, onhover, ondetail }: {
    selected: ElementRef | null; hovered: ElementRef | null;
    onselect: (ref: ElementRef | null) => void; onhover: (ref: ElementRef | null) => void;
    ondetail: (detail: { label: string; value: string; at: string } | null) => void;
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
  let hit = $state.raw<Hit | null>(null);
  let appliedView: View | undefined;
  let appliedVersion = -1;
  export function focus() { canvas.focus({ preventScroll: true }); }
  const quantity = $derived(plot.quantity);
  const unit = $derived(measureUnit(quantity.unit, plot.basis));
  const elements = $derived(new PlotElements(plot.data.name, quantity.channels));
  const label = (channel: Channel) => (channel.class ?? (channel.element.collection === 'buses' ? 'Bus' : 'Device')) + ' ' + channel.label;
  const inspectionId = $props.id();
  const inspection = $derived([selected && elements.channels(selected)[0] ? 'Selected: ' + label(elements.channels(selected)[0]!) : '', hovered && elements.channels(hovered)[0] ? 'Hovered: ' + label(elements.channels(hovered)[0]!) : ''].filter(Boolean).join('. '));
  const localChannel = $derived(elements.channel(hit?.row ?? null));
  const hoveredChannel = $derived(localChannel && sameReference(localChannel.element, hovered) ? localChannel : elements.channels(hovered)[0]);
  const sample = $derived(hit && elements.channel(hit.row) === hoveredChannel ? hit.sample : undefined);
  const numbers = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 });
  $effect(() => ondetail(hoveredChannel ? { label: label(hoveredChannel), value: sample ? numbers.format(sample.value) + (unit ? ' ' + unit : '' ) : '', at: sample ? sample.at.toFixed(3) + ' s' : '' } : null));
  const palette = $derived.by(() => {
    void preferences.theme; void preferences.contrast;
    const css = getComputedStyle(document.documentElement);
    const read = (name: string) => colorHex(css.getPropertyValue(name).trim(), true) ?? '#808080';
    return { bg: read('--color-surface-1'), grid: read('--color-graph-grid'), text: read('--color-text-1'), ticks: read('--color-text-3'), hover: read('--color-graph-hover'), selected: read('--color-graph-selection'),
      lines: [read('--color-primary-text'), '#0072b2', '#009e73', '#d55e00', '#cc79a7', '#56b4e9', '#e69f00', '#6c6c6c'] };
  });
  const scene = $derived<Scene>({
    ease: 0,
    // The dock names the quantity, units, and time; the canvas keeps only the numeric axes.
    space: { plot: { x: { label: null }, y: { label: null } } },
    // Traces keep 4.5:1 contrast with the plot's ground, or 7:1 in high contrast.
    theme: { base: preferences.theme, background: palette.bg, grid: palette.grid, contrast: preferences.contrast === 'high' ? 7 : 4.5,
      focus: { hover: palette.hover, selected: palette.selected },
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
    let stopResize: (() => void) | undefined;
    const listeners: (() => void)[] = [];
    let measured = '';
    // Resolve the shared caption role once and on resize, never on playback frames.
    const readTypography = () => {
      const css = getComputedStyle(canvas), font = css.fontFamily, size = parseFloat(css.fontSize);
      if (typography?.font !== font || typography?.size !== size) typography = { font, size };
    };
    // Latkit reserves 1.5 em outside numeric gutters. Keep the labels, with just 2 px outside them.
    const compactInsets = () => {
      if (!live) return;
      const edge = 2 - 1.5 * (typography?.size ?? 14);
      live.insets = [edge, edge, edge, edge];
    };
    readTypography();
    // The axis's ends on screen: projecting the times shown finds them wherever the value labels leave the plot area.
    const measure = () => {
      const camera = live?.camera;
      if (disposed || !live || !camera || !('x' in camera)) return;
      const value = camera.y?.[0] ?? 0, start = live.screen([camera.x[0], value, 0]), end = live.screen([camera.x[1], value, 0]);
      if (!start || !end) return;
      const axis = { left: start[0], width: end[0] - start[0], from: camera.x[0], to: camera.x[1] }, key = JSON.stringify(axis);
      if (key !== measured) { measured = key; onaxis(axis); }
    };
    const report = (manual = false) => {
      measure();
      if (disposed || !live) return;
      const camera = live.camera;
      if ('x' in camera) onviewport({ x: [...camera.x], y: camera.y ? [...camera.y] : null }, canvas.width, manual);
    };
    const afterResize = () => {
      stopResize?.(); stopResize = undefined;
      if (!live || !canvas.clientWidth || !canvas.clientHeight) return;
      // Latkit's frame listeners precede drawing. The microtask reads the layout after that draw,
      // independent of browser observer ordering. Unsubscribe immediately: idle plots stay idle.
      stopResize = live.gpu.on('frame', () => {
        stopResize?.(); stopResize = undefined;
        queueMicrotask(() => report());
      });
    };
    const observer = new ResizeObserver(() => { readTypography(); compactInsets(); afterResize(); });
    observer.observe(canvas);
    void (async () => {
      try {
        await latkit();
        if (disposed) return;
        const camera = plot.camera;
        live = await View.create(canvas, scene, { sources: [plot.data], camera: { x: [...camera.x], y: camera.y ? [...camera.y] : null } });
        if (disposed) { live.destroy(); return; }
        compactInsets();
        appliedView = live; appliedVersion = camera.version;
        // Streaming can keep summaries refining while valid frames are on screen: the plot is ready once one is drawn.
        listeners.push(live.on('at', at => onseek(at)), live.on('hovered', event => { hit = event.hit; onhover(elements.channel(hit?.row ?? null)?.element ?? null); }),
          live.on('selection', ({ rows, trigger }) => {
            if (!trigger) return;
            const row = rows.find(row => row.data === plot.data.name && row.table === 'Trace' && row.ids.length);
            onselect(elements.channel(row ? { data: row.data, table: row.table, id: row.ids[0]! } : null)?.element ?? null);
          }),
          live.on('camera', () => report(true)), live.on('waiting', () => { ready ||= live!.stats.frames > 0; measure(); }),
          live.on('error', failure => { error = failure.message; }));
        view = live; report(); afterResize();
      } catch (cause) { if (!disposed) error = errorMessage(cause); }
    })();
    return () => { disposed = true; onhover(null); ondetail(null); observer.disconnect(); stopResize?.(); listeners.forEach(off => off()); live?.destroy(); };
  });
  $effect(() => { if (view) view.scene = scene; });
  $effect(() => { if (view) view.selection = elements.rows(selected); });
  $effect(() => { if (view) view.hovered = hoveredChannel ? { data: plot.data.name, table: 'Trace', id: hoveredChannel.column } : null; });
  $effect(() => { if (view) return playhead.attach(view); });
  $effect(() => {
    const current = view, camera = plot.camera;
    if (!current || (current === appliedView && camera.version === appliedVersion)) return;
    current.camera = { x: [...camera.x], y: camera.y ? [...camera.y] : null };
    appliedView = current; appliedVersion = camera.version;
  });
  watchNotice(() => error ? 'The plot could not be drawn. ' + error : '', () => ({ action: { label: 'Retry plot', run: onretry } }));
</script>

<div class="plot-canvas">
  <span class="sr-only" id={inspectionId}>{inspection}</span>
  <canvas bind:this={canvas} tabindex={error ? -1 : 0} aria-busy={!ready && !error}
    aria-describedby={inspectionId} aria-label={`${quantity.label} plot${unit ? ` (${unit})` : ''}, time in seconds`}></canvas>
</div>

<style>
  .plot-canvas { position: relative; height: 100%; min-height: 0; }
  canvas { display: block; width: 100%; height: 100%; font: var(--type-caption); }
</style>
