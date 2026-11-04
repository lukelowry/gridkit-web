<script module lang="ts">
  /** What an export last made, which the next opens on this session. */
  let lastKind: 'image' | 'video' = 'image';
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { errorMessage } from '../ui/errors.js';
  import { copy, fileName, held, save, type FileName } from '../ui/files.js';
  import { earthSpace } from '../mappings/defaults.js';
  import { applies, pictureSizes, preferenceFields, type PreferenceKey, type Preferences } from '../preferences/definitions.js';
  import PreferenceControl from '../preferences/PreferenceControl.svelte';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import { speeds } from '../simulation/playhead.svelte.js';
  import Dialog from '../ui/Dialog.svelte';
  import { notify } from '../ui/toasts.svelte.js';
  import { heightFor, picture, pixelsOf, video, type Drawing, type ExportRequest, type PictureSize } from './export.js';

  /**
   * Exports what a view shows as a picture or a video, previewed as it will be saved. Its choices are preferences, kept from one
   * export to the next, each shown while it applies as Preferences shows it; a map's geography is the view's own. A video's times
   * belong to this export alone.
   */
  let { request, name, preferences, onclose }: {
    request: ExportRequest;
    /** The file's name, without its extension. */
    name: string;
    preferences: PreferencesState;
    onclose: () => void;
  } = $props();
  const id = $props.id();
  const kinds = [{ id: 'image', label: 'Image' }, { id: 'video', label: 'Video' }] as const;
  /** Bits a video spends on each pixel of each frame, by quality. */
  const bits = { standard: 0.15, high: 0.3, best: 0.6 } as const satisfies Record<Preferences['exportVideoQuality'], number>;
  /** Whether the browser lets the user choose where a file goes; elsewhere it downloads. */
  const picks = typeof window.showSaveFilePicker === 'function';
  let kind = $state<'image' | 'video'>(lastKind);
  const map = untrack(() => earthSpace(request.view.scene.space));
  const range = untrack(() => request.run?.range ?? [0, 0]);
  let start = $state(range[0]), end = $state(range[1]), speed = $state(untrack(() => request.run?.playhead.speed ?? 1));
  /** What is done of the export in progress, from 0 to 1; `null` with none. */
  let progress = $state<number | null>(null);
  let error = $state(''), copied = $state(false);
  let preview = $state(''), previewError = $state(''), drawing = $state(false);
  let working: AbortController | undefined, previewUrl: string | undefined;

  $effect(() => { lastKind = kind; });
  const settings = $derived(preferences.value);
  const busy = $derived(progress !== null);
  const noVideo = $derived(!request.run ? 'Run a simulation to export a video.' : typeof VideoEncoder !== 'function' ? 'This browser cannot encode video.' : '');
  const preset = $derived(settings.exportSize === 'view' || settings.exportSize === 'custom' ? null : pictureSizes[settings.exportSize]);
  /** A journal page's width, which only pictures take. */
  const paper = $derived(preset && 'width' in preset ? preset : null);
  const text = $derived(Number(settings.exportText));
  /** What the export draws: the request as the options shape it. */
  const shown = $derived<ExportRequest>({ ...request, plot: settings.exportPlot ? request.plot : undefined });
  /** The picture's layout and pixels per CSS pixel: the view's, a screen's, the user's own, or a page's width, as high as the view showed. */
  const size = $derived.by<PictureSize>(() => {
    const scale = Number(settings.exportScale);
    if (settings.exportSize === 'view') return { layout: request.canvas, ratio: scale };
    if (settings.exportSize === 'custom') return { layout: [settings.exportWidth / scale, settings.exportHeight / scale], ratio: scale };
    return paper ? { layout: [paper.width, heightFor(shown, paper.width, text)], ratio: paper.ratio } : preset as PictureSize;
  });
  const look = $derived<Drawing>({ size, framing: settings.exportFraming, text });
  const framed = $derived(pixelsOf(size));
  // A video's width is a multiple of 4 and its height even, as its encoder takes them.
  const pixels = $derived(kind === 'video' ? [framed[0] - framed[0] % 4, framed[1] - framed[1] % 2] as const : framed);
  const transparent = $derived(kind === 'image' && settings.exportFormat !== 'jpeg' && settings.exportBackground === 'transparent');
  const fps = $derived(Number(settings.exportFrameRate));
  const timed = $derived(Number.isFinite(start) && Number.isFinite(end) && end > start);
  const length = $derived(timed ? (end - start) / speed : 0);
  const bitrate = $derived(Math.round(bits[settings.exportVideoQuality] * pixels[0] * pixels[1] * fps));
  const megabytes = $derived(bitrate * length / 8 / 1e6);
  const recordable = $derived(kind === 'image' || (!noVideo && timed && !paper));

  // The view drew something new once it settles with another scene or datasets, such as geography just chosen and loaded.
  let changed = $state(0);
  $effect(() => {
    const { view } = request;
    let drawn = { scene: view.scene, sources: view.sources };
    return view.on('waiting', waiting => {
      if (waiting.length || (view.scene === drawn.scene && view.sources === drawn.sources)) return;
      drawn = { scene: view.scene, sources: view.sources };
      changed++;
    });
  });
  // The preview follows what Save makes, drawn small a moment after the options or the view settle; a newer one replaces any still drawing.
  $effect(() => {
    const making = shown, { layout } = size, options = look, clear = transparent, scale = Math.min(2, devicePixelRatio);
    void changed;
    if (busy) return;
    const small: PictureSize = { layout, ratio: Math.min(size.ratio, 640 * scale / layout[0], 400 * scale / layout[1]) };
    const abort = new AbortController(), timer = setTimeout(() => void draw(making, { ...options, size: small }, clear, abort.signal), 150);
    return () => { clearTimeout(timer); abort.abort(); };
  });
  async function draw(making: ExportRequest, options: Drawing, clear: boolean, signal: AbortSignal) {
    drawing = true;
    const { output, file } = held('image/png');
    try {
      await picture(making, output, { ...options, format: 'png', transparent: clear, signal });
      const blob = await file;
      if (signal.aborted) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      preview = previewUrl = URL.createObjectURL(blob);
      previewError = '';
    } catch (cause) {
      if (!signal.aborted) previewError = errorMessage(cause, 'The preview could not be drawn.');
    } finally {
      if (!signal.aborted) drawing = false;
    }
  }

  /** Saves the export where the user chooses; the dialog closes once it is written. */
  function saveFile() {
    if (busy || !recordable) return;
    const making = shown, options = look, abort = working = new AbortController(), { signal } = abort;
    const file: FileName = kind === 'video' ? `${fileName(name)}.mp4` : `${fileName(name)}.${settings.exportFormat}`;
    const write = kind === 'video'
      ? (output: WritableStream<Uint8Array>) => video({ ...making, run: making.run! }, output, { ...options, fps, from: start, to: end, speed,
        orbit: Number(settings.exportOrbit), bitrate, signal, progress: done => { progress = done; } })
      : (output: WritableStream<Uint8Array>) => picture(making, output, { ...options, format: settings.exportFormat, transparent, signal,
        ...settings.exportFormat === 'jpeg' && { quality: settings.exportQuality } });
    error = '';
    void save(file, output => { progress = 0; return write(output); }).then(made => {
      if (made) { notify(`Saved ${file}`, { tone: 'info' }); dismiss(); }
    }, (cause: unknown) => { if (!signal.aborted) error = errorMessage(cause, 'Could not export.'); })
      .finally(() => { if (working === abort) { working = undefined; progress = null; } });
  }

  /** Copies the picture as a PNG. */
  function copyPicture() {
    const making = shown, options = { ...look, format: 'png' as const, transparent };
    error = '';
    copy(output => picture(making, output, options)).then(() => {
      copied = true;
      setTimeout(() => { copied = false; }, 1600);
    }, (cause: unknown) => { error = errorMessage(cause, 'Could not copy the picture.'); });
  }

  /** Esc and Close stop an export in progress, keeping what was chosen; once nothing runs, they close the dialog. */
  function close() {
    if (busy) working?.abort();
    else dismiss();
  }
  function dismiss() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onclose();
  }

  /** The tabs take the arrow keys, as a row of tabs does. */
  function step(event: KeyboardEvent) {
    const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'image' : event.key === 'ArrowRight' || event.key === 'End' ? 'video' : null;
    if (!next) return;
    event.preventDefault();
    kind = next;
    window.document.getElementById(`${id}-${next}`)?.focus();
  }
  const clamp = (time: number) => Math.min(range[1], Math.max(range[0], time));
  /** Inches at 600 dpi, as a journal measures a figure. */
  const inches = (pixels: number) => Number((pixels / 600).toFixed(2));
</script>

{#snippet choice(key: PreferenceKey)}
  <PreferenceControl preference={preferenceFields[key]} value={settings[key]} label={preferenceFields[key].label} id="{id}-{key}"
    onchange={next => preferences.set(key, next)} />
{/snippet}
<!-- A preference's row, while it applies, named as this dialog names it. -->
{#snippet row(key: PreferenceKey, label: string = preferenceFields[key].label)}
  {#if applies(key, settings)}
    <label for="{id}-{key}">{label}</label>
    <div class="controls">{@render choice(key)}</div>
  {/if}
{/snippet}

<Dialog label="Export" closeLabel="Close export" {busy} onclose={close}>
  {#snippet tabs()}
    <div class="kinds" role="tablist" aria-label="Export as">
      {#each kinds as option (option.id)}
        <button type="button" role="tab" id="{id}-{option.id}" aria-selected={kind === option.id} aria-controls="{id}-panel"
          tabindex={kind === option.id ? 0 : -1} disabled={busy} onclick={() => { kind = option.id; }} onkeydown={step}>{option.label}</button>
      {/each}
    </div>
  {/snippet}

  <div class="export">
    <figure class="preview" aria-busy={drawing} style:--ratio={size.layout[0] / size.layout[1]}>
      <div class="picture" class:clear={transparent}>
        {#if preview}<img src={preview} alt={kind === 'video' ? 'The video at the current time' : 'The picture as it will be saved'} />{/if}
        {#if previewError}<p class="preview-error" role="status">{previewError}</p>{/if}
      </div>
      {#if request.run}<figcaption>At {request.run.playhead.time.toFixed(2)} s</figcaption>{/if}
    </figure>

    <div class="panel" id="{id}-panel" role="tabpanel" aria-labelledby="{id}-{kind}">
      {#if kind === 'video' && noVideo}
        <p class="unavailable">{noVideo}</p>
      {:else}
        <!-- A fieldset, so an export in progress holds every choice still. -->
        <fieldset class="settings" disabled={busy}>
          <h3>Output</h3>
          {#if kind === 'image'}
            {@render row('exportFormat')}
            {@render row('exportQuality', 'Quality')}
            {@render row('exportBackground')}
          {:else}
            <label for="{id}-start">Time</label>
            <div class="controls">
              <span class="c-field"><input id="{id}-start" aria-label="Start" type="number" min={range[0]} max={range[1]} step="0.1" value={start}
                aria-invalid={!timed} aria-describedby={timed ? undefined : `${id}-time-error`}
                onchange={event => { start = clamp(event.currentTarget.valueAsNumber); event.currentTarget.value = String(start); }} /><span class="c-field__suffix">s</span></span>
              <span class="joiner" aria-hidden="true">to</span>
              <span class="c-field"><input aria-label="End" type="number" min={range[0]} max={range[1]} step="0.1" value={end}
                aria-invalid={!timed} aria-describedby={timed ? undefined : `${id}-time-error`}
                onchange={event => { end = clamp(event.currentTarget.valueAsNumber); event.currentTarget.value = String(end); }} /><span class="c-field__suffix">s</span></span>
              {#if start !== range[0] || end !== range[1]}
                <button type="button" class="whole" onclick={() => { start = range[0]; end = range[1]; }}>Whole run</button>
              {/if}
              {#if !timed}<p class="field-error" id="{id}-time-error">End must be after start.</p>{/if}
            </div>
            <label for="{id}-speed">Speed</label>
            <div class="controls">
              <select id="{id}-speed" bind:value={speed}>{#each speeds as rate (rate)}<option value={rate}>{rate}×</option>{/each}</select>
              {@render choice('exportFrameRate')}
            </div>
            {@render row('exportVideoQuality')}
            {@render row('exportOrbit')}
          {/if}
          <label for="{id}-exportSize">Size</label>
          <div class="controls">
            {@render choice('exportSize')}
            {#if applies('exportScale', settings)}{@render choice('exportScale')}{/if}
          </div>
          {#if applies('exportWidth', settings)}
            <label for="{id}-exportWidth">Pixels</label>
            <div class="controls">{@render choice('exportWidth')}<span class="joiner" aria-hidden="true">×</span>{@render choice('exportHeight')}</div>
          {/if}
          {@render row('exportFraming')}

          <h3>Contents</h3>
          {#if map}
            {@render row('geography')}
            {@render row('geographyUrl', 'URL')}
          {/if}
          {#if request.plot}{@render row('exportPlot')}{/if}
          {@render row('exportText')}
        </fieldset>
      {/if}
    </div>
  </div>

  {#snippet leading()}
    {#if error}<p class="error" role="alert">{error}</p>
    {:else if kind === 'video' && paper && !noVideo}<p class="note">Journal sizes are for images.</p>
    {:else}
      <dl class="summary">
        <div><dt>Pixels</dt><dd>{pixels[0]} × {pixels[1]}</dd></div>
        {#if paper && kind === 'image'}<div><dt>Print</dt><dd>{inches(pixels[0])} × {inches(pixels[1])} in</dd></div>{/if}
        {#if kind === 'video' && !noVideo}
          <div><dt>Duration</dt><dd>{length.toFixed(1)} s</dd></div>
          <div><dt>Frames</dt><dd>{timed ? Math.floor(length * fps) + 1 : 0}</dd></div>
          <div><dt>File size</dt><dd>About {megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB</dd></div>
        {/if}
      </dl>
    {/if}
  {/snippet}
  {#snippet footer()}
    {#if busy}
      <div class="progress">
        <progress max="1" value={progress} aria-label={kind === 'video' ? 'Recording' : 'Saving'}></progress>
        <span aria-hidden="true">{kind === 'video' ? `${Math.round((progress ?? 0) * 100)}%` : 'Saving'}</span>
      </div>
      <button type="button" onclick={() => working?.abort()}>Stop</button>
    {:else}
      {#if kind === 'image'}<button type="button" title="Copy as PNG" onclick={copyPicture}>{copied ? 'Copied' : 'Copy'}</button>{/if}
      <button type="button" class="primary" disabled={!recordable} onclick={saveFile}>{picks ? 'Save…' : 'Download'}</button>
    {/if}
    <span class="sr-only" role="status">{copied ? 'Picture copied' : ''}</span>
  {/snippet}
</Dialog>

<style>
  /* Tabs choosing what the whole dialog makes: the chosen one tinted, as Preferences marks its page. */
  .kinds { display: flex; gap: var(--spacing-2xs); }
  .kinds button { min-height: 26px; padding: 2px var(--spacing-sm); color: var(--color-text-2); font: var(--type-label); }
  .kinds button[aria-selected="true"] { background: var(--color-selected); color: var(--color-primary-text); }

  .export { display: grid; grid-template-columns: minmax(0, 1fr) 23rem; flex: 1; min-height: 0; }
  /* The preview is the picture's shape, as large as the pane holds it, its time beneath. */
  .preview { container-type: size; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--spacing-sm);
    min-height: 0; margin: 0; padding: var(--spacing-lg); border-right: 1px solid var(--color-border); background: var(--color-surface-2); }
  .picture { position: relative; width: min(100cqw, calc((100cqh - 1.5rem) * var(--ratio))); aspect-ratio: var(--ratio); overflow: hidden;
    border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-1); }
  .picture img { display: block; width: 100%; height: 100%; transition: opacity 150ms ease-out; }
  .preview[aria-busy="true"] img { opacity: 0.55; }
  /* A transparent picture shows its ground as the checks behind it. */
  .picture.clear { background: repeating-conic-gradient(var(--color-surface-1) 0 25%, var(--color-surface-2) 0 50%) 0 0 / 16px 16px; }
  .preview-error { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: var(--spacing-md);
    color: var(--color-text-3); font: var(--type-compact); text-align: center; overflow-wrap: anywhere; }
  figcaption { color: var(--color-text-3); font: var(--type-caption); font-variant-numeric: tabular-nums; }

  .panel { min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .unavailable { margin: 0; padding: var(--spacing-lg); color: var(--color-text-2); font: var(--type-compact); }
  /* Dense rows beside the preview: labels quieter than their values, each control as wide as what it holds. */
  .settings { display: grid; grid-template-columns: 5rem minmax(0, 1fr); align-items: center; gap: var(--spacing-sm) var(--spacing-md);
    padding: var(--spacing-xs) var(--spacing-lg) var(--spacing-lg); }
  .settings:disabled { opacity: 0.6; }
  .settings h3 { grid-column: 1 / -1; margin: var(--spacing-md) 0 calc(-1 * var(--spacing-2xs)); color: var(--color-text-3); font: var(--type-caption); font-weight: 600; }
  .settings > label { color: var(--color-text-2); font: var(--type-compact); }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-xs) 6px; min-width: 0; }
  /* Short values share one width, so the column reads as one edge. */
  .controls :global(select) { width: auto; min-width: 6rem; }
  .controls :global(.c-field) { width: 5.5rem; }
  .controls :global(.c-field input) { text-align: right; }
  .controls > :global(input[type="url"]) { width: 100%; }
  .joiner { color: var(--color-text-3); font: var(--type-compact); }
  .whole { min-height: 0; padding: 2px var(--spacing-xs); color: var(--color-primary-text); font: var(--type-caption); font-weight: 500; }
  .controls .field-error { flex-basis: 100%; }

  /* What Save makes, each measure under its name. */
  .summary { display: flex; flex-wrap: wrap; gap: var(--spacing-xs) var(--spacing-lg); margin: 0; }
  .summary div { display: grid; }
  .summary dt { font: var(--type-caption); }
  .summary dd { color: var(--color-text-1); font: var(--type-label); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .error, .note { max-width: 48ch; margin: 0; font: var(--type-caption); overflow-wrap: anywhere; }
  .error { color: var(--color-error); }
  .note { color: var(--color-text-2); }
  .progress { display: flex; align-items: center; gap: var(--spacing-sm); min-width: 10rem; color: var(--color-text-2); font: var(--type-caption);
    font-variant-numeric: tabular-nums; }
  .progress progress { appearance: none; flex: 1; height: 4px; border: 0; border-radius: 2px; background: var(--color-divider); overflow: hidden; }
  .progress progress::-webkit-progress-bar { background: var(--color-divider); }
  .progress progress::-webkit-progress-value { background: var(--color-primary-text); }
  .progress progress::-moz-progress-bar { background: var(--color-primary-text); }
  .progress span { min-width: 4ch; text-align: right; }

  @media (max-width: 640px) {
    .export { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(10rem, 36%) minmax(0, 1fr); }
    .preview { border-right: 0; border-bottom: 1px solid var(--color-border); padding: var(--spacing-md); }
    .summary { gap: 2px var(--spacing-md); }
  }
</style>
