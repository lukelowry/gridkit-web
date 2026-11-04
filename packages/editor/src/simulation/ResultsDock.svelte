<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Preferences } from '../preferences/definitions.js';
  import type { PreferencesState } from '../preferences/state.svelte.js';
  import type { PlotAxis } from './plot.js';
  import type { ArtifactName, TimeRange } from '@gridkit/solver';
  import type { RunSession } from './run.svelte.js';
  import { save } from '../ui/files.js';
  import { eventActions } from './solver-fields.js';
  import { speeds } from './playhead.svelte.js';
  import { defaultBand, measureUnit, percentable } from '../domain/measure.js';
  import { rampCss, scaleTicks, type ColorScale } from '../ui/ramps.js';
  import { notify } from '../ui/toasts.svelte.js';
  import { errorMessage } from '../ui/errors.js';
  import ResultsPlot from './ResultsPlot.svelte';
  import Icon from '../ui/Icon.svelte';
  import Popover from '../ui/Popover.svelte';

  type Side = Preferences['resultsDock'];
  let { run, preferences, side, scale = null, collapsed = $bindable(false), ondock, onclose }: {
    run: RunSession; preferences: PreferencesState; collapsed?: boolean;
    /** Where in the workspace the results lie. */
    side: Side;
    /** What the network's colors mean, for what it reads. */
    scale?: ColorScale | null;
    /** Moves the results to the other side; without it, they stay where they are. */
    ondock?: ((side: Side) => void) | undefined;
    /** Closes the results, discarding them. */
    onclose: () => void;
  } = $props();
  const labels: Record<ArtifactName, string> = { results: 'results', log: 'log', solver: 'solver settings' };
  /** Where the dock button moves the results from each side, drawn as the layout it makes. */
  const docks = {
    bottom: { to: 'right', label: 'Dock results on the right', icon: 'dock-right' },
    right: { to: 'bottom', label: 'Dock results at the bottom', icon: 'dock-bottom' },
  } as const;
  const plot = $derived(run.plot);
  const time = $derived(run.playhead.time);
  let measured = $state.raw<PlotAxis | null>(null);
  const axis = $derived(plot ? measured : null);
  // The scrubber spans the plot's time axis and the times it shows, so each moment sits under the same moment on the plot.
  const domain = $derived<TimeRange>(axis ? [axis.from, axis.to] : run.timeline);
  const span = $derived(Math.max(domain[1] - domain[0], Number.EPSILON));
  const fraction = (at: number) => Math.min(1, Math.max(0, (at - domain[0]) / span));
  const percent = (at: number) => `${fraction(at) * 100}%`;
  const marks = $derived(run.events.filter(event => event.time >= domain[0] && event.time <= domain[1]));
  const seconds = (at: number) => at.toFixed(2);
  const deviating = $derived(run.basis !== 'value');
  const measuredFrom = $derived(run.reference ?? run.range[0]);
  const unit = $derived(plot?.quantity.unit);
  const displayUnit = $derived(plot ? measureUnit(unit, plot.basis) : '');
  const scopes = $derived([...new Set(run.quantities.map(quantity => quantity.scope))]);
  const contentId = $props.id();
  let plotAttempt = $state(0);
  let plotView = $state<ResultsPlot>();
  let options = $state<Popover>();
  async function retryPlot() {
    measured = null; plotAttempt++;
    await tick();
    plotView?.focus();
  }
  let scrubber = $state<HTMLInputElement>();
  // Bounds before the value, together: a value outside earlier bounds was clamped to them, and would stay there.
  $effect(() => {
    if (!scrubber) return;
    scrubber.min = String(domain[0]); scrubber.max = String(domain[1]);
    untrack(() => { scrubber!.value = String(run.playhead.time); });
  });
  // Every frame while time moves, so it writes only the value.
  $effect(() => { if (scrubber) scrubber.value = String(time); });
</script>

<svelte:document onvisibilitychange={() => { if (document.hidden) run.play(false); }} />
<section class={['results-dock', side]} aria-label="Simulation">
  <div class="results-toolbar">
    <div class="results-measure">
      <select class="results-quantity" aria-label="Plot quantity" title={plot?.quantity.label}
        disabled={!run.quantities.length} value={plot?.quantity.key ?? ''}
        onchange={event => run.select(event.currentTarget.value)}>
        <button type="button"><selectedcontent></selectedcontent></button>
        {#if !run.quantities.length}<option value="">{run.busy ? 'Preparing results…' : 'No quantities'}</option>{/if}
        {#each scopes as scope (scope)}
          <optgroup label={scope}>
            {#each run.quantities.filter(quantity => quantity.scope === scope) as quantity (quantity.key)}<option value={quantity.key}>{quantity.label}</option>{/each}
          </optgroup>
        {/each}
      </select>
      {#if displayUnit}<span class="results-unit" aria-label={run.basis === 'value' ? displayUnit : `${run.basis === 'percent' ? 'Percent change' : 'Change'}, ${displayUnit}`}>
        ({run.basis === 'percent' ? '% change' : `${run.basis === 'change' ? 'Δ ' : ''}${displayUnit}`})
      </span>{/if}
    </div>
    <div class="results-panel-actions">
      <output class="run-status" class:busy={run.busy} class:completed={run.status === 'Completed'} class:failed={run.failed}
        aria-label="Simulation status">{run.status}</output>
      {#if run.busy}<button class="c-icon-btn" aria-label="Stop simulation" title="Stop simulation" onclick={() => run.cancel()}><Icon name="stop" /></button>{/if}
      <Popover bind:this={options} label="Plot options" width={256} align="end">
        {#snippet trigger(popup)}<button class="c-icon-btn" aria-label="Plot options" title="Plot options" aria-haspopup="dialog" popovertarget={popup}><Icon name="more" /></button>{/snippet}
        {#snippet children(close)}
          <p class="options-status">{run.status}</p>
          <fieldset class="c-options" disabled={!plot}>
            <legend>Display</legend>
            {#each [{ value: 'value', label: 'Value' }, { value: 'change', label: 'Change' }, { value: 'percent', label: 'Percent change' }] as choice (choice.value)}
              <label class="c-action" title={choice.value === 'percent' && !percentable(unit) ? 'Percent change is unavailable for angles.' : undefined}>
                <input type="radio" name={`${contentId}-basis`} value={choice.value} checked={run.basis === choice.value}
                  disabled={choice.value === 'percent' && !percentable(unit)}
                  onchange={async () => { run.measure(choice.value as typeof run.basis); await tick(); options?.reposition(); }} />{choice.label}
              </label>
            {/each}
          </fieldset>
          {#if deviating}
            <div class="c-options" role="group" aria-label="Reference">
              <span class="c-options__label">Reference · {seconds(measuredFrom)} s</span>
              <button class="c-action" type="button" disabled={run.reference === null} onclick={() => { close(); run.measure(run.basis, null); }}><Icon name="reference" />From start</button>
              <button class="c-action" type="button" disabled={!plot} onclick={() => { close(); run.measure(run.basis, run.playhead.time); }}><Icon name="reference" />From current time</button>
            </div>
          {/if}
          <div class="c-options">
            <button class="c-action" type="button" disabled={!plot || run.live} onclick={() => { close(); run.follow(); }}><Icon name="play" />Follow live</button>
            <button class="c-action" type="button" disabled={!plot} onclick={() => { close(); run.fit(); }}><Icon name="fit" />Fit plot</button>
          </div>
          {#if scale}
            <div class="color-scale">
              <span class="property-label">{scale.name}</span>
              <i class="c-ramp" style:background={rampCss(scale.map, scale.fit)}></i>
              <div class="ticks">{#each scaleTicks(scale.map, scale.domain, scale.signed) as tick (tick.at)}<span style:--at={tick.at}>{tick.text}</span>{/each}</div>
              {#if deviating}
                <span class="c-field"><span class="c-field__suffix">±</span>
                  <input aria-label="Network color band" type="number" min="0" step="any" placeholder={String(defaultBand(run.networkMeasure))} value={run.band ?? ''}
                    oninput={event => { const value = event.currentTarget.valueAsNumber; run.band = value > 0 ? value : null; }} />
                </span>
              {/if}
            </div>
          {/if}
          <div class="c-options">
            {#each run.artifacts as artifact (artifact.name)}
              {#if 'href' in artifact}
                <a class="c-action" href={artifact.href} download={artifact.file} onclick={close}><Icon name="download" />Download {labels[artifact.name]}</a>
              {:else}
                <!-- Made only when asked: the save starts in this click, which a save picker needs. -->
                <button class="c-action" type="button" onclick={() => { close(); save(artifact.file, artifact.write).catch(cause => notify(errorMessage(cause))); }}><Icon name="download" />Download {labels[artifact.name]}</button>
              {/if}
            {/each}
          </div>
          <div class="c-options">
            {#if ondock}
              {@const move = docks[side]}
              <button class="c-action" type="button" aria-label={move.label} onclick={() => { close(); ondock?.(move.to); }}><Icon name={move.icon} />{side === 'bottom' ? 'Dock right' : 'Dock bottom'}</button>
            {/if}
            {#if side === 'bottom'}
              <button class="c-action" type="button" aria-label={collapsed ? 'Expand results' : 'Collapse results'} aria-expanded={!collapsed} aria-controls={contentId}
                onclick={() => { close(); collapsed = !collapsed; }}><Icon name={collapsed ? 'up' : 'chevron'} />{collapsed ? 'Expand' : 'Collapse'}</button>
            {/if}
          </div>
        {/snippet}
      </Popover>
      <button class="c-icon-btn" aria-label="Close results" title="Close and discard results" onclick={onclose}><Icon name="close" /></button>
    </div>
  </div>
  <div id={contentId} class="results-content" hidden={collapsed && side === 'bottom'}>
    <!-- Controls stay visible while the plot uses the remaining height. Its error details can scroll. -->
    <div class="results-body">
      {#if plot}
        {#key plot.data}{#key plotAttempt}
          <ResultsPlot bind:this={plotView} {plot} playhead={run.playhead} {preferences} onretry={retryPlot}
            onseek={at => run.seek(at)} onviewport={(viewport, pixels, manual) => run.viewport(viewport, pixels, manual)} onaxis={next => { measured = next; }} />
        {/key}{/key}
      {:else}
        <p class="results-empty" role="status">{run.busy ? 'Preparing results…' : 'No simulation results.'}</p>
      {/if}
    </div>
    <!-- Playback stays together; narrow docks put time and speed below the timeline. -->
    <div class="playback">
      <button class="c-icon-btn" aria-label={run.playing ? 'Pause' : 'Play'} title={run.playing ? 'Pause' : 'Play'}
        disabled={!plot || run.range[0] === run.range[1]} onclick={() => run.play(!run.playing)}><Icon name={run.playing ? 'pause' : 'play'} /></button>
      <div class="scrubber">
        <div class="scrubber__track" aria-hidden="true">
          <i class="scrubber__recorded" style:transform={`scaleX(${fraction(run.range[1])})`}></i>
          <i class="scrubber__played" style:transform={`scaleX(${fraction(time)})`}></i>
        </div>
        {#if deviating}<span class="scrubber__reference" aria-hidden="true" style:left={percent(measuredFrom)}></span>{/if}
        <div class="scrubber__marks" aria-hidden="true">
          {#each marks as event, index (index)}<span style:left={percent(event.time)} title={`${eventActions[event.type].label} at ${event.time} s`}></span>{/each}
        </div>
        <input bind:this={scrubber} aria-label="Simulation time" aria-valuetext={`${seconds(time)} seconds`} type="range" step="any" disabled={!plot} oninput={event => {
          const input = event.currentTarget;
          const at = Math.max(run.range[0], Math.min(run.range[1], input.valueAsNumber));
          input.valueAsNumber = at;
          run.seek(at);
        }} />
      </div>
      <div class="playback-meta">
        <output class="time" aria-label="Current simulation time" aria-live="off"><span class="time-label">Time</span> {seconds(time)}<span class="time-duration"> / {seconds(run.timeline[1])}</span> <span>s</span></output>
        <select class="speed" aria-label="Playback speed" bind:value={run.playhead.speed} disabled={!plot || run.live}>
          <button type="button"><selectedcontent></selectedcontent></button>
          {#each speeds as speed (speed)}<option value={speed}>{speed}×</option>{/each}
        </select>
      </div>
    </div>
  </div>
</section>

<style>
  .results-dock { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%;
    container: results / inline-size; border-top: 1px solid var(--color-border); background: var(--color-surface-1); font: var(--type-compact); }
  .results-dock.right { border-top: 0; border-left: 1px solid var(--color-border); }
  .results-toolbar { display: flex; align-items: center; flex: none; gap: var(--spacing-xs); padding: var(--spacing-2xs) var(--spacing-xs); }
  .results-panel-actions { display: flex; align-items: center; flex: none; gap: var(--spacing-2xs); margin-inline-start: auto; }
  .results-measure { display: flex; align-items: center; gap: var(--spacing-xs); min-width: 0; }
  .results-quantity { width: auto; max-width: 18rem; min-width: 0; text-overflow: ellipsis; white-space: nowrap; }
  .results-unit { flex: none; color: var(--color-text-3); font: var(--type-caption); white-space: nowrap; }
  .results-content { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; border-top: 1px solid var(--color-divider); }
  .results-body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  select { width: auto; min-height: var(--control-height); border-color: transparent; background-color: transparent; padding-block: var(--spacing-2xs); }
  @container results (max-width: 480px) {
    .run-status.completed { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  }
  .options-status { margin: 0; padding: var(--spacing-sm) var(--spacing-md); color: var(--color-text-2); border-bottom: 1px solid var(--color-divider); }
  /* What the network's colors mean, in the options, opening them above the commands. */
  .color-scale { display: grid; gap: var(--spacing-xs); padding: var(--spacing-sm); border-bottom: 1px solid var(--color-border); }
  .ticks { position: relative; height: 1.1rem; color: var(--color-text-3); font: var(--type-caption); font-variant-numeric: tabular-nums; }
  /* Each value centers under its place, the ends held inside the ramp. */
  .ticks span { position: absolute; left: calc(var(--at) * 100%); transform: translateX(calc(var(--at) * -100%)); white-space: nowrap; }
  .run-status { color: var(--color-text-2); font: var(--type-caption); white-space: nowrap; }
  .run-status.busy { color: var(--color-info); }
  .run-status.completed { color: var(--color-success); }
  .run-status.failed { color: var(--color-error); }
  .time { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; contain: layout paint; white-space: nowrap; }
  .time span { color: var(--color-text-3); }
  .time-label { font: var(--type-caption); margin-right: var(--spacing-xs); }
  .speed { flex: none; text-align-last: right; }
  .results-empty { margin: 0; height: 100%; display: grid; place-items: center; padding: 16px 12px; color: var(--color-text-2); }
  .playback { display: grid; grid-template-columns: var(--control-height) minmax(0, 1fr); align-items: center;
    flex: none; gap: 0 var(--spacing-sm); padding: var(--spacing-2xs) var(--spacing-sm); border-top: 1px solid var(--color-divider); }
  .playback-meta { display: flex; min-width: 0; grid-column: 1 / -1; align-items: center; justify-content: space-between; gap: var(--spacing-sm); padding-left: var(--spacing-xs); }
  .scrubber { position: relative; min-width: 0; height: var(--control-height);
    --track: color-mix(in oklab, var(--color-primary-text) 30%, var(--color-divider)); }
  @container results (min-width: 520px) {
    .playback { grid-template-columns: var(--control-height) minmax(0, 1fr) auto; }
    .playback-meta { grid-column: auto; }
  }
  @container results (max-width: 420px) { .time-label { display: none; } }
  .scrubber__track { position: absolute; inset-inline: 0; top: calc(50% - 2px); height: 4px; overflow: hidden; border-radius: 2px; background: var(--color-divider); forced-color-adjust: none; }
  /* Scaled, not resized: as time moves, the compositor moves them and nothing repaints. */
  .scrubber__track i { position: absolute; inset: 0; transform-origin: left; will-change: transform; }
  .scrubber__recorded { background: var(--track); }
  .scrubber__played { background: var(--color-primary-text); }
  /* Where deviations are measured from: a flag over the track, apart from the events' ticks. */
  .scrubber__reference { position: absolute; top: calc(50% - 10px); width: 9px; height: 7px; margin-left: -4.5px; background: var(--color-primary-text); clip-path: polygon(0 0, 100% 0, 50% 100%); pointer-events: none; forced-color-adjust: none; }
  .scrubber__marks { position: absolute; inset: 0; pointer-events: none; }
  .scrubber__marks span { position: absolute; top: calc(50% - 9px); width: 1px; height: 6px; background: var(--color-text-3); }
  /* The input reaches one thumb radius past each end, so the thumb's center lands on the axis's first and last times. */
  .scrubber input { appearance: none; -webkit-appearance: none; position: absolute; inset: 0 -6px; width: calc(100% + 12px); height: 100%; min-height: 0;
    margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: pointer; }
  .scrubber input:disabled { cursor: default; }
  .scrubber:has(input:disabled) :is(.scrubber__track, .scrubber__marks) { opacity: 0.5; }
  .scrubber input::-webkit-slider-runnable-track { height: 4px; background: transparent; }
  .scrubber input::-moz-range-track { height: 4px; background: transparent; }
  .scrubber input::-webkit-slider-thumb { -webkit-appearance: none; box-sizing: border-box; width: 12px; height: 12px; margin-top: -4px;
    border: 2px solid var(--color-primary-text); border-radius: 50%; background: var(--color-surface-1); }
  .scrubber input::-moz-range-thumb { box-sizing: border-box; width: 12px; height: 12px; border: 2px solid var(--color-primary-text); border-radius: 50%;
    background: var(--color-surface-1); }
  .scrubber input:disabled::-webkit-slider-thumb { opacity: 0.5; }
  .scrubber input:disabled::-moz-range-thumb { opacity: 0.5; }
  .scrubber input:focus-visible { outline: none; }
  /* The thumb takes the focus ring; a pseudo-element has no outline of its own. */
  .scrubber input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 var(--focus-width) var(--color-focus); }
  .scrubber input:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 var(--focus-width) var(--color-focus); }
  @media (forced-colors: active) {
    .scrubber__track { background: GrayText; }
    .scrubber__recorded { background: CanvasText; }
    .scrubber__played, .scrubber__reference { background: Highlight; }
    .scrubber__marks span { background: CanvasText; forced-color-adjust: none; }
    .scrubber input:focus-visible { outline: var(--focus-width) solid Highlight; outline-offset: -2px; }
  }

</style>
