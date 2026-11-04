<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Data, type Source } from 'latkit';
  import type { CaseDocument, ElementRef, SavedViews } from '@gridkit/library';
  import { geographyOf } from '../preferences/definitions.js';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import { earthSpace, networkSpace, type Palette } from '../mappings/defaults.js';
  import { fieldsIn } from '../domain/views.js';
  import { sampledName, simulationFields } from '../simulation/sampled.js';
  import type { RunSession } from '../simulation/run.svelte.js';
  import { measureOf } from '../domain/measure.js';
  import { colorScaleOf } from '../mappings/encoding.js';
  import type { ColorScale } from '../ui/ramps.js';
  import { sameReference } from '../domain/entries.js';
  import { colorHex } from '../ui/color.js';
  import Icon from '../ui/Icon.svelte';
  import type { MenuItem } from '../ui/Menu.svelte';
  import { dataset, refOf, rowsOf, tables } from './data.js';
  import { networkScene, spaceOf, tablesOf, themeOf } from './scene.js';
  import type { ExportRequest } from './export.js';
  import type { CaseView } from './view.js';
  import { undocked, NetworkHost, type Dock } from './network-host.svelte.js';

  let { document, mappings, geographic, active, selected, preferences, run = null, onscale, dock = undocked, onselect, onopen, onmenu, ontable, onexport, exportable = $bindable(false) }: {
    document: CaseDocument;
    mappings: SavedViews;
    geographic: boolean;
    active: boolean;
    selected: ElementRef | null;
    preferences: PreferencesState;
    run?: RunSession | null;
    onscale?: (scale: ColorScale | null) => void;
    dock?: Dock;
    onselect: (ref: ElementRef | null) => void;
    onopen: (ref: ElementRef) => void;
    onmenu: (ref: ElementRef | null, at: { x: number; y: number }, local: MenuItem[]) => void;
    ontable: () => void;
    onexport: (request: ExportRequest, subject: string) => void;
    exportable?: boolean;
  } = $props();

  const tilt = 45;
  let canvas = $state<HTMLCanvasElement>();
  let globe = $state(untrack(() => preferences.value.defaultProjection === 'globe'));
  let pitch = $state(0);
  // The geography under a map, a dataset for each of its files, and their tables, which the network draws as lines.
  let geography = $state.raw<readonly Data[]>([]);
  const geographyTables = $derived(geography.flatMap(data => data.describe().tables.map(table => [data.name, table.name] as const)));
  // Its files, which change only when the choice of them does.
  const geographyFiles = $derived(JSON.stringify(geographyOf(preferences.value)));
  let geographyNotice = $state('');
  let toolbarHeight = $state(0);
  let toolbarWidth = $state(0);
  let picked: ElementRef | null | undefined;

  // Normalize CSS colors for the editor's contrast calculations; the theme attribute is set before effects read this.
  const palette = $derived.by((): Palette => {
    void preferences.theme; void preferences.contrast;
    const style = getComputedStyle(window.document.documentElement);
    const read = (name: string) => colorHex(style.getPropertyValue(name).trim(), true) ?? '#808080';
    return { background: read('--color-bg'), vertex: read('--color-primary-text'), line: read('--color-graph-line'), text: read('--color-text-1'),
      grid: read('--color-graph-grid'), surface: read('--color-surface-2'), hover: read('--color-graph-hover'),
      selected: read('--color-graph-selection') };
  });
  const simulationActive = $derived(!!run?.data && run.channels.length > 0);
  const scene = $derived.by(() => {
    return networkScene({ document, preferences, palette, mappings, geographic, globe, simulation: simulationActive, sampled: run?.sampledFields ?? [], measure: run?.networkMeasure, band: run?.band,
      geography: geographyTables });
  });
  // The buses' mark, whose colors tell the results.
  const colored = $derived(scene.entries.find(entry => entry?.mark.target.collection === 'buses')?.mark);
  // What the buses' colors mean while results play; latkit fits a colormap to the view's background.
  const scale = $derived.by<ColorScale | null>(() => {
    if (!simulationActive) return null;
    const mark = colored, read = colorScaleOf(mark?.options.color);
    if (!mark || !read) return null;
    const { output, basis } = measureOf(read.field), info = simulationFields(document)(mark.target).find(field => field.id === output);
    const unit = basis === 'percent' ? '%' : info?.unit;
    const ground = themeOf(scene.scene);
    return { name: `${info?.label ?? output}${unit ? ` (${unit})` : ''}`, map: read.map, domain: read.domain, signed: basis !== 'value',
      fit: { grounds: [ground?.background].filter(color => typeof color === 'string'), floor: ground?.contrast ?? 4.5 } };
  });
  $effect(() => { const shown = scale; untrack(() => onscale?.(shown)); });
  const earth = $derived(earthSpace(networkSpace(geographic, preferences.mappings, mappings)));
  const empty = $derived(document.size === 0);
  const rows = $derived(tables(document));
  const extra = (): Source[] => [...geography, ...run?.data ? [run.data] : []];
  const host = new NetworkHost({
    document: () => document, scene: () => scene, rows: () => rows, extra, dock: () => dock,
    clearance: () => toolbarHeight,
    pitch: () => preferences.value.defaultProjection === 'tilt' ? tilt : 0,
    listen,
  });
  const fault = $derived(active ? host.fault : '');
  const issues = $derived(active && host.opened ? [...scene.diagnostics, ...host.diagnostics] : []);
  const fittable = $derived(active && !host.stopped && !fault && host.ready && !empty);
  $effect(() => { exportable = fittable; });
  export function exportShown() { if (fittable) exportView(); }
  function exportView() {
    const opened = host.opened;
    if (!opened || !canvas) return;
    const played = simulationActive && run ? run : undefined;
    const plot = played && [...played.playhead.views].find(view => spaceOf(view.scene) === 'plot');
    onexport({ view: opened.view, canvas: [canvas.clientWidth, canvas.clientHeight], tables: host.framed(), ...played && { run: played },
      ...plot && { plot: { view: plot, dock } } }, 'network');
  }
  function listen(opened: CaseView) {
    const view = opened.view;
    view.on('selection', ({ rows, trigger }) => {
      if (!trigger) return;
      const row = rows.find(row => row.data === dataset && row.ids.length), ref = row ? refOf({ table: row.table, id: row.ids[0]! }) : null;
      picked = ref;
      onselect(ref && document.get(ref) ? ref : null);
    });
    view.on('open', ({ hit }) => {
      if (hit.row.data !== dataset) return;
      const ref = refOf(hit.row);
      if (document.get(ref)) onopen(ref);
    });
    view.on('menu', ({ hits, trigger }) => {
      if (!canvas) return;
      const hit = hits.find(hit => hit.row.data === dataset && document.get(refOf(hit.row)));
      const ref = hit ? refOf(hit.row) : trigger.device === 'keyboard' ? selected : null, box = canvas.getBoundingClientRect();
      picked = ref;
      canvas.focus({ preventScroll: true });
      onmenu(ref, { x: box.left + trigger.point[0], y: box.top + trigger.point[1] }, [
        { label: 'Fit view', icon: 'fit', disabled: !fittable, run: () => {
          host.fit();
          queueMicrotask(() => canvas?.focus({ preventScroll: true }));
        } },
        { label: 'Export…', icon: 'export', disabled: !fittable, run: exportView },
      ]);
    });
    view.on('camera', camera => { if ('pitch' in camera) pitch = camera.pitch; });
  }
  function project(next: 'flat' | 'tilt' | 'globe') {
    globe = next === 'globe';
    host.opened?.view.fly({ pitch: next === 'tilt' ? tilt : 0 });
  }
  $effect(() => {
    const opened = host.opened;
    if (opened && simulationActive) return run!.playhead.attach(opened.view);
  });
  $effect(() => {
    const fields = scene.entries.flatMap(entry => entry ? fieldsIn(entry.mark.options)
      .flatMap(name => sampledName(name) ?? [])
      .map(field => ({ ...entry.mark.target, field })) : []);
    if (run?.channels.length) untrack(() => run.sample(fields));
  });

  $effect(() => {
    const shown = active && !host.stopped, target = canvas;
    untrack(() => { host.activate(shown); if (shown) void host.show(target); });
  });
  // Hidden networks catch up with data and scene changes when shown.
  $effect(() => {
    const opened = host.opened;
    if (!active || host.stopped) return;
    scene; rows; extra();
    if (opened) untrack(() => host.update());
  });
  $effect(() => { if (active) host.applyInsets(); });
  $effect(() => {
    const opened = host.opened;
    if (!active || host.stopped || !opened) return;
    const rows = rowsOf(document, selected);
    untrack(() => { opened.view.selection = rows; });
  });
  // Pointer selection stays in place; selections from another control are revealed.
  $effect(() => {
    const ref = selected, opened = host.opened;
    if (!active || host.stopped || !opened || !ref || sameReference(picked ?? null, ref)) return;
    untrack(() => {
      const row = rowsOf(document, ref)[0];
      if (row && tablesOf(scene).has(row.table))
        void opened.view.fit({ reveal: { data: dataset, table: row.table, id: row.ids[0]! } }).catch(() => {});
    });
  });
  $effect(() => {
    const files = JSON.parse(geographyFiles) as string[];
    geographyNotice = '';
    if (!host.opened || host.stopped || !earth || !files.length) return;
    const abort = new AbortController(), loaded: Data[] = [];
    geographyNotice = 'Loading geography…';
    void (async () => {
      try {
        const read = await Promise.all(files.map(async (url, index) => {
          const response = await fetch(url, { signal: abort.signal });
          if (!response.ok) throw new Error(response.statusText);
          const data = await Data.read(response, { name: `geography-${index}`, signal: abort.signal });
          // A file read after the choice changed is freed at once.
          if (abort.signal.aborted) { data.destroy(); throw abort.signal.reason; }
          loaded.push(data);
          return data;
        }));
        // The network view takes them, then the scene drawing them, once shown.
        geography = read;
        geographyNotice = '';
      } catch {
        if (!abort.signal.aborted) geographyNotice = 'Geography unavailable. Check its source in Preferences.';
      }
    })();
    return () => {
      abort.abort();
      // The view keeps the versions it holds until the scene without geography marks replaces it.
      geography = [];
      for (const data of loaded) data.destroy();
    };
  });

  onDestroy(() => {
    host.destroy();
    for (const data of geography) data.destroy();
  });
</script>

<div class="network-view">
  <canvas bind:this={canvas} hidden={!active} aria-label="Network view" data-ready={host.ready} tabindex="0"></canvas>
  {#if active && geographyNotice && !fault}
    <p class="geography-notice" role="status">{geographyNotice}</p>
  {/if}
  {#if fault}
    <div class="view-message render-status" role="alert">
      <p>Rendering is unavailable.</p>
      <div class="render-status__actions">
        {#if !host.stopped}<button onclick={() => host.retry(canvas)}>Try rendering again</button>{/if}
        <button onclick={ontable}>Open Table</button>
      </div>
      <details><summary>Details</summary><p>{fault}</p></details>
    </div>
  {:else if active && !host.ready && !empty}
    <div class="view-message render-status">
      <p role="status">Drawing network…</p>
      <button onclick={ontable}>Open Table</button>
    </div>
  {:else if active && empty}
    <div class="view-message empty-message">
      <p>Add a model to get started.</p>
      <span>Add buses and branches from Table.</span>
    </div>
  {/if}
  {#if issues.length}
    <div class="view-heading" style:--toolbar-height="{toolbarHeight}px" style:--toolbar-width="{toolbarWidth}px">
      <details class="mapping-notice"><summary>Some mappings are unavailable ({issues.length})</summary>
        <ul>{#each issues as issue, index (issue.path + ':' + index)}<li><strong>{issue.path}</strong>: {issue.message}</li>{/each}</ul>
      </details>
    </div>
  {/if}
  <div class="view-toolbar c-toolbar" role="group" aria-label="Network controls" bind:offsetHeight={toolbarHeight} bind:offsetWidth={toolbarWidth}>
    <button class="c-icon-btn" aria-label="Flat" title="Flat" aria-pressed={!globe && pitch < 1} disabled={!host.ready} onclick={() => project('flat')}><Icon name="projection-flat" /></button>
    <button class="c-icon-btn" aria-label="Tilt" title="Tilt" aria-pressed={!globe && pitch >= 1} disabled={!host.ready} onclick={() => project('tilt')}><Icon name="projection-tilt" /></button>
    <button class="c-icon-btn" aria-label="Globe" title={earth ? 'Globe' : 'Globe requires geographic bus coordinates'} aria-pressed={globe && earth}
      disabled={!host.ready || !earth} onclick={() => project('globe')}><Icon name="projection-globe" /></button>
    <span class="c-toolbar__divider" aria-hidden="true"></span>
    <button class="c-icon-btn" aria-label="Fit view" title="Fit view" disabled={!fittable} onclick={() => host.fit()}><Icon name="fit" /></button>
  </div>
</div>

<style>
  .network-view, canvas { width: 100%; height: 100%; }
  .network-view { position: relative; container: canvas-view / inline-size; overflow: hidden; background: var(--color-bg); }
  canvas { display: block; }
  canvas:focus-visible { outline-offset: calc(-1 * var(--focus-width)); }
  .view-toolbar { position: absolute; top: var(--spacing-md); right: calc(var(--spacing-md) + var(--dock-width, 0px));
    max-width: calc(100% - 24px - var(--dock-width, 0px)); flex-wrap: wrap; justify-content: flex-end; }
  .geography-notice { position: absolute; left: 12px; bottom: 12px; max-width: calc(100% - 24px); margin: 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-3); font: var(--type-compact); }
  .view-heading { position: absolute; inset: var(--spacing-md) calc(var(--spacing-md) + var(--dock-width, 0px)) auto var(--spacing-md); display: grid; justify-items: start; max-height: 40%; pointer-events: none; }
  .mapping-notice { pointer-events: auto; max-width: min(48ch, calc(100% - var(--toolbar-width) - var(--spacing-md))); max-height: 100%; overflow: auto; padding: var(--spacing-sm);
    border: 1px solid color-mix(in oklch, var(--color-warning) 40%, var(--color-warning-surface)); border-radius: var(--radius-md);
    background: var(--color-warning-surface); color: var(--color-warning); font: var(--type-compact); overflow-wrap: anywhere; }
  .mapping-notice ul { padding-inline-start: 20px; }
  .mapping-notice li + li { margin-top: var(--spacing-sm); }
  @container canvas-view (max-width: 640px) {
    .view-heading { padding-top: calc(var(--toolbar-height) + var(--spacing-sm)); max-height: none; }
    .mapping-notice { max-width: 100%; max-height: 10rem; }
  }
  .empty-message { pointer-events: none; }
  .empty-message span { font: var(--type-compact); }
  .render-status { overflow: auto; text-align: center; }
  .render-status__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--spacing-sm); }
</style>
