<script module lang="ts">
  let lastKind: 'image' | 'video' = 'image';
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { errorMessage } from '../ui/errors.js';
  import { copy, fileName, held, save, type FileName } from '../ui/files.js';
  import { applies, pictureSizes, preferenceFields, type PreferenceKey, type Preferences } from '../preferences/definitions.js';
  import PreferenceControl from '../preferences/PreferenceControl.svelte';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import { speeds } from '../simulation/playhead.svelte.js';
  import Dialog from '../ui/Dialog.svelte';
  import Icon from '../ui/Icon.svelte';
  import LoadingBar from '../ui/LoadingBar.svelte';
  import { notify, watchNotice } from '../ui/toasts.svelte.js';
  import { heightFor, picture, pixelsOf, video, videoSize, type Drawing, type ExportFrame, type ExportRequest, type PictureSize } from './export.js';

  let { request, name, preferences, onclose }: {
    request: ExportRequest; name: string; preferences: PreferencesState; onclose: () => void;
  } = $props();
  const id = $props.id();
  const kinds = [{ id: 'image', label: 'Image' }, { id: 'video', label: 'Video' }] as const;
  const bits = { standard: 0.15, high: 0.3, best: 0.6 } as const satisfies Record<Preferences['exportVideoQuality'], number>;
  const picks = typeof window.showSaveFilePicker === 'function';
  let kind = $state<'image' | 'video'>(lastKind);
  const range = untrack(() => request.run?.range ?? [0, 0]);
  const shownTime = untrack(() => request.run?.playhead.time ?? request.view.at);
  let start = $state(range[0]), end = $state(range[1]), speed = $state(untrack(() => request.run?.playhead.speed ?? 1));
  let position = $state(shownTime);
  let progress = $state<number | null>(null);
  let invalidFields = $state<Record<string, boolean>>({});
  let error = $state(''), copied = $state(false);
  let previewExpanded = $state(false);
  let preview = $state(''), previewError = $state(''), drawing = $state(false);
  let working = $state<AbortController>();
  let previewWork = Promise.resolve();
  let previewUrl: string | undefined, copiedTimer: ReturnType<typeof setTimeout> | undefined;

  // Hold the same frame while choosing output. Returning to the workspace resumes its prior playback mode.
  onMount(() => {
    const run = request.run, following = run?.live, playing = run?.playhead.playing;
    run?.seek(shownTime);
    return () => {
      working?.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      clearTimeout(copiedTimer);
      void previewWork.finally(() => {
        if (run) {
          if (following) run.follow();
          else { run.seek(shownTime); if (playing) run.playhead.play(); }
        }
      });
    };
  });
  $effect(() => { lastKind = kind; });
  const settings = $derived(preferences.value);
  const busy = $derived(!!working);
  const noVideo = $derived(!request.run ? 'Run a simulation to export a video.' : typeof VideoEncoder !== 'function' ? 'This browser cannot encode video.' : '');
  const preset = $derived(settings.exportSize === 'view' || settings.exportSize === 'custom' ? null : pictureSizes[settings.exportSize]);
  const paper = $derived(preset && 'width' in preset ? preset : null);
  const shown = $derived<ExportRequest>({ ...request, plot: settings.exportPlot ? request.plot : undefined });
  const requestedSize = $derived.by<PictureSize>(() => {
    const scale = Number(settings.exportScale);
    if (settings.exportSize === 'view') return { layout: request.canvas, ratio: scale };
    if (settings.exportSize === 'custom') return { layout: [settings.exportWidth / scale, settings.exportHeight / scale], ratio: scale };
    return paper ? { layout: [paper.width, heightFor(shown, paper.width)], ratio: paper.ratio } : preset as PictureSize;
  });
  const size = $derived(kind === 'video' ? videoSize(requestedSize) : requestedSize);
  const look = $derived<Drawing>({ size, framing: settings.exportFraming, text: Number(settings.exportText) });
  const pixels = $derived(pixelsOf(size));
  const transparent = $derived(kind === 'image' && settings.exportFormat !== 'jpeg' && settings.exportBackground === 'transparent');
  const fps = $derived(Number(settings.exportFrameRate));
  const timed = $derived(Number.isFinite(start) && Number.isFinite(end) && end > start);
  const bitrate = $derived(Math.round(bits[settings.exportVideoQuality] * pixels[0] * pixels[1] * fps));
  const recordable = $derived(!Object.values(invalidFields).some(Boolean) && (kind === 'image' || (!noVideo && timed && !paper)));
  const previewTime = $derived(timed ? Math.min(end, Math.max(start, position)) : start);
  const frame = $derived<ExportFrame | undefined>(kind === 'video' && timed ? {
    at: previewTime, turn: (previewTime - start) / speed * Number(settings.exportOrbit), span: [start, end],
  } : undefined);
  watchNotice(() => error || previewError);
  watchNotice(() => kind === 'video' ? noVideo || (paper ? 'Choose a screen or custom size for video.' : !timed ? 'End must be after start.' : '') : '');

  // Both kinds preview the same composition and frame that the encoder uses.
  $effect(() => {
    const making = shown, options = look, clear = transparent, at = frame;
    if (busy || !recordable) { drawing = false; return; }
    const bounds = previewExpanded ? [Math.min(1600, window.innerWidth), Math.min(1200, window.innerHeight)] : [640, 400];
    const scale = Math.min(2, devicePixelRatio), { layout } = size;
    const small: PictureSize = { layout, ratio: Math.min(size.ratio, bounds[0]! * scale / layout[0], bounds[1]! * scale / layout[1]) };
    const abort = new AbortController();
    drawing = true;
    const timer = setTimeout(() => { previewWork = draw(making, { ...options, size: small }, clear, at, abort.signal); }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  });
  async function draw(making: ExportRequest, options: Drawing, clear: boolean, at: ExportFrame | undefined, signal: AbortSignal) {
    const { output, file } = held('image/png');
    try {
      await picture(making, output, { ...options, format: 'png', transparent: clear, frame: at, signal });
      const blob = await file;
      if (signal.aborted) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      preview = previewUrl = URL.createObjectURL(blob);
      previewError = '';
    } catch (cause) {
      if (!signal.aborted) previewError = errorMessage(cause, 'The preview could not be drawn.');
    } finally { if (!signal.aborted) drawing = false; }
  }

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
    void save(file, output => { signal.throwIfAborted(); progress = 0; return write(output); }).then(made => {
      if (made && !signal.aborted) { notify(`Saved ${file}`, { tone: 'info' }); onclose(); }
    }, (cause: unknown) => { if (!signal.aborted) error = errorMessage(cause, 'Could not export.'); })
      .finally(() => { if (working === abort) { working = undefined; progress = null; } });
  }
  function copyPicture() {
    if (busy || !recordable) return;
    const abort = working = new AbortController(), { signal } = abort;
    const making = shown, options = { ...look, format: 'png' as const, transparent, signal };
    error = '';
    void copy(output => picture(making, output, options)).then(() => {
      if (signal.aborted) return;
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; }, 1600);
    }, (cause: unknown) => { if (!signal.aborted) error = errorMessage(cause, 'Could not copy the picture.'); })
      .finally(() => { if (working === abort) working = undefined; });
  }
  function close() { if (busy) working?.abort(); else onclose(); }
  function step(event: KeyboardEvent) {
    const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'image' : event.key === 'ArrowRight' || event.key === 'End' ? 'video' : null;
    if (!next) return;
    event.preventDefault(); kind = next;
    window.document.getElementById(`${id}-${next}`)?.focus();
  }
  const clamp = (time: number) => Number.isFinite(time) ? Math.min(range[1], Math.max(range[0], time)) : range[0];
</script>

{#snippet choice(key: PreferenceKey)}
  <PreferenceControl preference={preferenceFields[key]}
    value={settings.exportSize !== 'custom' && key === 'exportWidth' ? pixels[0] : settings.exportSize !== 'custom' && key === 'exportHeight' ? pixels[1] : settings[key]}
    label={preferenceFields[key].label} id="{id}-{key}" disabled={!applies(key, settings)}
    oninvalid={next => { invalidFields[key] = next; }} onchange={next => preferences.set(key, next)} />
{/snippet}
{#snippet row(key: PreferenceKey, label: string = preferenceFields[key].label)}
  <label for="{id}-{key}">{label}</label><div class="controls">{@render choice(key)}</div>
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
      <div class="picture-area">
        <button type="button" class="picture" class:clear={transparent} aria-label="Enlarge preview" aria-haspopup="dialog"
          disabled={!preview || busy} onclick={() => { previewExpanded = true; }}>
          {#if preview}<img src={preview} alt={kind === 'video' ? 'The video at the selected time' : 'The picture as it will be saved'} />{/if}
        </button>
      </div>
      <LoadingBar busy={drawing} label="Drawing preview" />
      <figcaption>
        <input type="range" aria-label="Preview time" class:inactive={kind !== 'video' || !!noVideo} tabindex={kind === 'video' && !noVideo ? 0 : -1}
          aria-hidden={kind !== 'video' || !!noVideo} min={start} max={end} step="any" value={previewTime} disabled={busy || !timed}
          oninput={event => { position = event.currentTarget.valueAsNumber; }} />
        <span class:inactive={!request.run}>{(kind === 'video' ? previewTime : shownTime).toFixed(2)} s</span>

      </figcaption>
    </figure>
    <div class="panel" id="{id}-panel" role="tabpanel" aria-labelledby="{id}-{kind}">
      <fieldset class="settings" disabled={busy || (kind === 'video' && !!noVideo)}>
        {#if kind === 'image'}
          {@render row('exportFormat')}
          {@render row('exportQuality', 'Quality')}
          {@render row('exportBackground')}
        {:else}
          <label for="{id}-start">Time</label>
          <div class="controls">
            <span class="c-field"><input id="{id}-start" aria-label="Start" type="number" min={range[0]} max={range[1]} step="0.1" value={start}
              aria-invalid={!noVideo && !timed} aria-describedby={!noVideo && !timed ? `${id}-time-error` : undefined}
              onchange={event => { start = clamp(event.currentTarget.valueAsNumber); event.currentTarget.value = String(start); }} /><span class="c-field__suffix">s</span></span>
            <span class="joiner" aria-hidden="true">&ndash;</span>
            <span class="c-field"><input aria-label="End" type="number" min={range[0]} max={range[1]} step="0.1" value={end}
              aria-invalid={!noVideo && !timed} aria-describedby={!noVideo && !timed ? `${id}-time-error` : undefined}
              onchange={event => { end = clamp(event.currentTarget.valueAsNumber); event.currentTarget.value = String(end); }} /><span class="c-field__suffix">s</span></span>
            <button type="button" class="c-icon-btn" aria-label="Whole run" title="Whole run" disabled={start === range[0] && end === range[1]}
              onclick={() => { start = range[0]; end = range[1]; }}><Icon name="undo" /></button>
            <span class="sr-only" id="{id}-time-error">{!noVideo && !timed ? 'End must be after start.' : ''}</span>
          </div>
          <label for="{id}-speed">Speed</label>
          <div class="controls"><select id="{id}-speed" bind:value={speed}>{#each speeds as rate (rate)}<option value={rate}>{rate}&times;</option>{/each}</select></div>
          {@render row('exportFrameRate')}
          {@render row('exportVideoQuality')}
          {@render row('exportOrbit')}
        {/if}
        <label for="{id}-exportSize">Size</label>
        <div class="controls">{@render choice('exportSize')}{@render choice('exportScale')}</div>
        <label for="{id}-exportWidth">Pixels</label>
        <div class="controls">{@render choice('exportWidth')}<span class="joiner" aria-hidden="true">&times;</span>{@render choice('exportHeight')}</div>
        {@render row('exportFraming')}
        {#if request.plot}{@render row('exportPlot')}{/if}
        {@render row('exportText')}
      </fieldset>
    </div>
  </div>
  {#snippet leading()}<span class="summary">{pixels[0]} &times; {pixels[1]} px</span>{/snippet}
  {#snippet footer()}
    {#if progress !== null}<progress class="export-progress" max="1" value={progress} aria-label={kind === 'video' ? 'Recording' : 'Saving'}></progress>{/if}
    <button type="button" class="export-action" class:inactive={kind !== 'image'} aria-hidden={kind !== 'image'} tabindex={kind === 'image' ? 0 : -1}
      title="Copy as PNG" disabled={busy || !recordable} onclick={copyPicture}><span class:inactive={copied}>Copy</span><span class:inactive={!copied}>Copied</span></button>
    <button type="button" class="primary export-action" disabled={!busy && !recordable} onclick={() => { if (busy) working?.abort(); else saveFile(); }}>
      <span class:inactive={busy}>{picks ? 'Save' : 'Download'}</span><span class:inactive={!busy}>Stop</span>
    </button>
    <span class="sr-only" role="status">{copied ? 'Picture copied' : ''}</span>
  {/snippet}
</Dialog>
{#if previewExpanded}
  <Dialog label="Export preview" closeLabel="Close preview" onclose={() => { previewExpanded = false; }}>
    <div class="expanded-preview"><img src={preview} alt="Enlarged export preview" /></div>
  </Dialog>
{/if}

<style>
  .kinds { display: flex; gap: var(--spacing-2xs); }
  .kinds button { min-height: 26px; padding: 2px var(--spacing-sm); color: var(--color-text-2); font: var(--type-label); }
  .kinds button[aria-selected="true"] { background: var(--color-selected); color: var(--color-primary-text); }
  .export { display: grid; grid-template-columns: minmax(0, 1fr) 22rem; flex: 1; min-height: 0; }
  .preview { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; margin: 0; padding: 12px;
    border-right: 1px solid var(--color-border); background: var(--color-surface-2); }
  .picture-area { container-type: size; display: grid; place-items: center; flex: 1; min-height: 0; }
  .picture { padding: 0; cursor: zoom-in; width: min(100cqw, calc(100cqh * var(--ratio))); aspect-ratio: var(--ratio); overflow: hidden;
    border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-1); }
  .picture img { display: block; width: 100%; height: 100%; }
  .picture.clear { background: repeating-conic-gradient(var(--color-surface-1) 0 25%, var(--color-surface-2) 0 50%) 0 0 / 16px 16px; }
  figcaption { display: flex; flex: none; align-items: center; gap: 8px; min-height: 32px; color: var(--color-text-2); font: var(--type-caption); }
  figcaption input { flex: 1; min-width: 0; accent-color: var(--color-primary-text); padding-inline: 0; }
  figcaption span { min-width: 5.5em; text-align: right; font-variant-numeric: tabular-nums; }
  .expanded-preview { display: grid; place-items: center; flex: 1; min-height: 0; padding: 8px; background: var(--color-surface-2); }
  .expanded-preview img { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
  .panel { min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .settings { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); align-items: center; gap: 8px 12px; padding: 16px; }
  .settings:disabled { opacity: 0.6; }
  .settings > label { color: var(--color-text-2); font: var(--type-compact); }
  .controls { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .controls :global(select), .controls :global(.c-field) { flex: 1; min-width: 0; width: 0; }
  .controls :global(.c-field input) { text-align: right; }
  .controls :global(select:last-of-type:not(:first-of-type)) { flex: 0 0 4rem; }
  .joiner { color: var(--color-text-3); font: var(--type-compact); }
  .summary { color: var(--color-text-2); font: var(--type-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .export-action { display: grid; }
  .export-action span { grid-area: 1 / 1; }
  .inactive { visibility: hidden; }
  .export-progress { position: absolute; inset: 0 0 auto; appearance: none; width: 100%; height: 2px; margin: 0; border: 0; background: var(--color-divider); overflow: hidden; }
  .export-progress::-webkit-progress-bar { background: var(--color-divider); }
  .export-progress::-webkit-progress-value { background: var(--color-primary-text); }
  .export-progress::-moz-progress-bar { background: var(--color-primary-text); }
  @media (max-width: 767px) {
    .export { display: flex; flex-direction: column; overflow: auto; overscroll-behavior: contain; }
    .preview { flex: none; height: clamp(140px, 28dvh, 240px); border-right: 0; border-bottom: 1px solid var(--color-border); padding: 8px 12px; }
    .panel { flex: none; overflow: visible; }
    .kinds button, figcaption { min-height: var(--spacing-touch-h); }
    .settings { gap: 6px 8px; padding: 12px; }
  }
</style>
