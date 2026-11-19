<script lang="ts">
  import { watchNotice } from '../ui/toasts.svelte.js';
  import { onMount } from 'svelte';
  import type { ElementRef } from '@gridkit/library';
  import type { Channel } from '@gridkit/library/gridkit';
  import { sameReference } from '../domain/entries.js';
  import { PlotElements } from './inspection.js';
  import { View, type Scene, type Hit } from 'latkit';
  import { plotDataset, type PlotAxis, type PlotData, type PlotViewport } from './plot.js';
  import type { Playhead } from './playhead.svelte.js';
  import { leastSpan, measureUnit } from '../domain/measure.js';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import { controlsOf, focusOf, latkit } from '../ui/latkit.js';
  import { themeColors } from '../ui/color.js';
  import { errorMessage } from '../ui/errors.js';

  let { plot, opening, playhead, preferences, onseek, onviewport, onaxis, onretry, selected, hovered, onselect, onhover, ondetail }: {
    selected: ElementRef | null; hovered: ElementRef | null;
    onselect: (ref: ElementRef | null) => void; onhover: (ref: ElementRef | null) => void;
    ondetail: (detail: { label: string; value: string; at: string } | null) => void;
    plot: PlotData; playhead: Playhead; preferences: PreferencesState;
    /** Where the view opens: where gestures last left the camera. */
    opening: PlotViewport;
    /** Draws the plot again in a new view, once this one cannot draw. */
    onretry: () => void;
    onseek: (time: number) => void;
    /** The times and values a gesture put in view. */
    onviewport: (viewport: PlotViewport) => void;
    /** Where the time axis is drawn, whenever it moves: a resize, a zoom, or wider value labels. */
    onaxis: (axis: PlotAxis) => void;
  } = $props();
  let canvas: HTMLCanvasElement;
  let view = $state.raw<View>();
  let error = $state('');
  /** Why results the plot draws are missing, until they are read: latkit reads them again on its own, after a wait. */
  let missing = $state('');
  let ready = $state(false);
  let typography = $state.raw<{ font: string; size: number }>();
  let hit = $state.raw<Hit | null>(null);
  let appliedView: View | undefined;
  let appliedCamera: PlotViewport | undefined;
  export function focus() { canvas.focus({ preventScroll: true }); }
  // Each changes only when what is drawn does, so a new camera re-derives nothing.
  const source = $derived(plot.source), quantity = $derived(plot.quantity), camera = $derived(plot.camera);
  const unit = $derived(measureUnit(quantity.unit, plot.basis));
  const elements = $derived(new PlotElements(source.name, quantity.channels));
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
    return themeColors({ background: '--color-surface-1', grid: '--color-graph-grid', text: '--color-text-1', ticks: '--color-text-3',
      hover: '--color-graph-hover', selected: '--color-graph-selection', trace: '--color-primary-text' });
  });
  // Input and highlights follow the settings the network follows; pressing or dragging across the plot moves the time shown.
  const controls = $derived(controlsOf(preferences.value, preferences.motion));
  const scene = $derived<Scene>({
    ease: 0,
    // The dock names the quantity, units, and time; the canvas keeps only the numeric axes.
    // A steady value draws flat at the least range its measure has, rather than filling the plot with the solver's noise.
    space: { plot: { x: { label: null }, y: { label: null, minSpan: leastSpan({ output: quantity.output, basis: plot.basis }) } } },
    // Traces keep 4.5:1 contrast with the plot's ground, or 7:1 in high contrast. The tick labels sit 2 px in from the canvas's edges.
    theme: { base: preferences.theme, background: palette.background, grid: { color: palette.grid }, contrast: preferences.contrast === 'high' ? 7 : 4.5,
      padding: 2, focus: focusOf(preferences.value, palette),
      text: { color: palette.ticks, ...typography }, plot: { playhead: palette.text } },
    marks: [{ lines: [plotDataset, 'Trace'], trace: 'value', interpolation: 'linear', width: preferences.contrast === 'high' ? 2.5 : 1.5,
      color: { colormap: { kind: 'categorical', colors: [palette.trace, '#0072b2', '#009e73', '#d55e00', '#cc79a7', '#56b4e9', '#e69f00', '#6c6c6c'] }, value: '$series' } }],
    controls: { ...controls, gestures: { ...controls.gestures, primary: 'scrub' } },
  });

  onMount(() => {
    let disposed = false;
    let live: View | undefined;
    const listeners: (() => void)[] = [];
    let reported = '';
    // Resolve the shared caption role once and on resize, never on playback frames.
    const readTypography = () => {
      const css = getComputedStyle(canvas), font = css.fontFamily, size = parseFloat(css.fontSize);
      if (typography?.font !== font || typography?.size !== size) typography = { font, size };
    };
    readTypography();
    // The time axis runs along where marks draw, across the times the camera shows. Until the plot draws, marks draw nowhere.
    const report = () => {
      const camera = live?.camera, [left, , width] = live?.area ?? [0, 0, 0, 0];
      if (disposed || !width || !camera || !('x' in camera)) return;
      const axis = { left, right: canvas.clientWidth - left - width, from: camera.x[0], to: camera.x[1] }, key = JSON.stringify(axis);
      if (key !== reported) { reported = key; onaxis(axis); }
    };
    const observer = new ResizeObserver(readTypography);
    observer.observe(canvas);
    void (async () => {
      try {
        await latkit();
        if (disposed) return;
        live = await View.create(canvas, scene, { sources: [source], camera: { x: [...opening.x], y: opening.y ? [...opening.y] : null } });
        if (disposed) { live.destroy(); return; }
        appliedView = live; appliedCamera = camera;
        listeners.push(live.on('at', at => onseek(at)), live.on('hovered', event => { hit = event.hit; onhover(elements.channel(hit?.row ?? null)?.element ?? null); }),
          live.on('selection', ({ rows, trigger }) => {
            if (!trigger) return;
            const row = rows.find(row => row.data === source.name && row.table === 'Trace' && row.ids.length);
            onselect(elements.channel(row ? { data: row.data, table: row.table, id: row.ids[0]! } : null)?.element ?? null);
          }),
          // A resize or wider value labels move where marks draw; a pan or a zoom moves the times.
          live.on('area', report),
          live.on('camera', camera => {
            report();
            if ('x' in camera) onviewport({ x: [...camera.x], y: camera.y ? [...camera.y] : null });
          }),
          // Tiles keep refining while valid frames are on screen: the plot is ready once one is drawn.
          live.on('waiting', () => { ready ||= live!.stats.frames > 0; }),
          // A file of the run's results that could not be read is listed under the tiles' name until it is.
          live.on('failures', failures => { missing = failures.find(failure => failure.path?.startsWith(source.name))?.message ?? ''; }),
          live.on('error', failure => { error = failure.message; }));
        view = live;
      } catch (cause) { if (!disposed) error = errorMessage(cause); }
    })();
    return () => { disposed = true; onhover(null); ondetail(null); observer.disconnect(); listeners.forEach(off => off()); live?.destroy(); };
  });
  $effect(() => { if (view) view.scene = scene; });
  // A new set swaps what the view draws: the canvas, its camera, and its axes stay.
  $effect(() => { if (view && view.sources[0] !== source) view.sources = [source]; });
  $effect(() => { if (view) view.selection = elements.rows(selected); });
  $effect(() => { if (view) view.hovered = hoveredChannel ? { data: source.name, table: 'Trace', id: hoveredChannel.column } : null; });
  $effect(() => { if (view) return playhead.attach(view); });
  // Only a command moves the camera: Fit, a new measure, or a new run.
  $effect(() => {
    const current = view, commanded = camera;
    if (!current || (current === appliedView && commanded === appliedCamera)) return;
    current.camera = { x: [...commanded.x], y: commanded.y ? [...commanded.y] : null };
    appliedView = current; appliedCamera = commanded;
  });
  watchNotice(() => error ? 'The plot could not be drawn. ' + error : '', () => ({ action: { label: 'Retry plot', run: onretry } }));
  // It clears once they are read; Retry reads them at once rather than after latkit's wait, up to a minute.
  watchNotice(() => !error && missing ? 'Some of the plot\'s results could not be read. ' + missing : '',
    () => ({ action: { label: 'Retry', run: () => plot.source.refresh() } }));
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
